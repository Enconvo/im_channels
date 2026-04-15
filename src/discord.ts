import { IMChannelProvider } from "@enconvo/api";
import { withRetry, splitMessage, sleep, loadToolsFromSchema, backoffDelay } from "./utils.ts";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const DISCORD_API = "https://discord.com/api/v10";
const DISCORD_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const DEBOUNCE_MS = 2000;
const DOWNLOAD_DIR = path.join(os.homedir(), ".config", "enconvo", "im_channels", "discord", "inbox");

export default function main(options: IMChannelProvider.Options) {
    return new DiscordProvider(options);
}

interface PendingBatch {
    messages: Array<{ authorName: string; content: string; channelId: string; userId: string; messageId: string; isDM: boolean; timestamp: string; files?: string[] }>;
    timer: ReturnType<typeof setTimeout>;
}

export class DiscordProvider extends IMChannelProvider {
    get maxMessageLength() { return 2000; }
    get defaultChannelId() { return this.options.channel_id || null; }

    private botToken: string | null = null;
    private botUserId: string | null = null;
    private ws: WebSocket | null = null;
    private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    private heartbeatWatchdog: ReturnType<typeof setInterval> | null = null;
    private lastHeartbeatAckAt: number = 0;
    private listenerActive = false;
    private pendingBatches = new Map<string, PendingBatch>();
    private typingIntervals = new Map<string, ReturnType<typeof setInterval>>();
    private lastSequence: number | null = null;
    private reconnectAttempts = 0;

    constructor(options: IMChannelProvider.Options) {
        super(options);
        this.botToken = options.botToken || null;
    }

    isReady(): boolean {
        return !!this.botToken;
    }

    async sendMessage(channelId: string, content: IMChannelProvider.MessageContent[], options?: IMChannelProvider.SendMessageOptions): Promise<IMChannelProvider.SendResult> {
        let messageCount = 0;

        for (const item of content) {
            const body: any = {};
            if (options?.replyTo) {
                body.message_reference = { message_id: options.replyTo };
            }

            if (item.type === "text") {
                const chunks = splitMessage(item.text, this.maxMessageLength);
                for (const chunk of chunks) {
                    await withRetry(() => this.restCall("POST", `/channels/${channelId}/messages`, { ...body, content: chunk }));
                }
                messageCount += chunks.length;
            } else {
                await withRetry(() => this.uploadFile(channelId, item.url, body));
                messageCount++;
            }
        }

        return { messageCount };
    }

    async readMessages(channelId: string, limit = 20): Promise<IMChannelProvider.ChannelMessage[]> {
        const data = await withRetry(() =>
            this.restCall("GET", `/channels/${channelId}/messages?limit=${Math.min(limit, 100)}`)
        ) as any[];

        return data
            .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .map((m: any) => ({
                id: m.id,
                author: m.author.username,
                content: m.content,
                timestamp: m.timestamp,
                isBot: m.author.bot || false,
            }));
    }

    async startListener(handler: IMChannelProvider.BotReplyHandler): Promise<void> {
        if (this.listenerActive) return;
        this.listenerActive = true;
        this.reconnectAttempts = 0;
        this.connectGateway(handler);
    }

    async stopListener(): Promise<void> {
        this.listenerActive = false;
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.heartbeatWatchdog) {
            clearInterval(this.heartbeatWatchdog);
            this.heartbeatWatchdog = null;
        }
        for (const batch of this.pendingBatches.values()) {
            clearTimeout(batch.timer);
        }
        this.pendingBatches.clear();
        for (const interval of this.typingIntervals.values()) {
            clearInterval(interval);
        }
        this.typingIntervals.clear();
        if (this.ws) {
            try { this.ws.close(); } catch { }
            this.ws = null;
        }
    }

    /**
     * Force a reconnect — closes the current WebSocket so the `connectGateway` loop
     * will re-establish the connection. Safe to call on healthy or dead sockets.
     */
    async reconnect(): Promise<void> {
        if (!this.listenerActive) return;
        console.log("[Discord] Forcing gateway reconnect");
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.heartbeatWatchdog) {
            clearInterval(this.heartbeatWatchdog);
            this.heartbeatWatchdog = null;
        }
        if (this.ws) {
            try { this.ws.close(); } catch { }
            this.ws = null;
        }
    }

    async destroy(): Promise<void> {
        await this.stopListener();
    }

    /** Send typing indicator immediately and repeat every 8s until stopTyping is called */
    private startTyping(channelId: string): void {
        // Already typing in this channel
        if (this.typingIntervals.has(channelId)) return;

        const sendTypingRequest = () => {
            if (!this.botToken) return;
            fetch(`${DISCORD_API}/channels/${channelId}/typing`, {
                method: "POST",
                headers: { Authorization: `Bot ${this.botToken}` },
            }).catch(() => { });
        };

        // Send immediately
        sendTypingRequest();

        // Repeat every 8s (Discord typing expires after 10s)
        const interval = setInterval(sendTypingRequest, 8000);
        this.typingIntervals.set(channelId, interval);
    }

    /** Stop the typing indicator for a channel */
    stopTyping(channelId: string): void {
        const interval = this.typingIntervals.get(channelId);
        if (interval) {
            clearInterval(interval);
            this.typingIntervals.delete(channelId);
        }
    }

    /** Download a Discord attachment to local disk, return the local path */
    private async downloadAttachment(att: any): Promise<string | null> {
        try {
            const url = att.url;
            if (!url) return null;

            const resp = await fetch(url);
            if (!resp.ok) return null;

            if (!fs.existsSync(DOWNLOAD_DIR)) {
                fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
            }

            const ext = path.extname(att.filename || "") || "";
            const baseName = path.basename(att.filename || "file", ext);
            const fileName = `${baseName}_${Date.now()}${ext}`;
            const localPath = path.join(DOWNLOAD_DIR, fileName);
            const buffer = Buffer.from(await resp.arrayBuffer());
            fs.writeFileSync(localPath, buffer);

            console.log(`[Discord] Downloaded attachment: ${localPath} (${buffer.length} bytes)`);
            return localPath;
        } catch (err: any) {
            console.error(`[Discord] Failed to download attachment:`, err.message);
            return null;
        }
    }

    getTools(): IMChannelProvider.ToolDefinition[] {
        return loadToolsFromSchema("discord_actions");
    }

    getSystemPromptGuidance(): string {
        return `When replying to an IM message, use the chat_id from the message header. If no chat_id is needed (e.g. just responding), you can omit it and the default channel is used. Use reply_to with message_id for threaded replies in channels (not in DMs). To DM a user, pass their numeric user_id instead of chat_id.`;
    }

    /**
     * Send a DM to a Discord user by user ID.
     * Creates a DM channel first, then sends the message.
     */
    async sendDM(userId: string, content: IMChannelProvider.MessageContent[]): Promise<IMChannelProvider.SendResult> {
        const dmChannel = await this.restCall("POST", "/users/@me/channels", {
            recipient_id: userId,
        });
        return this.sendMessage(dmChannel.id, content);
    }

    async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
        const encoded = encodeURIComponent(emoji);
        await withRetry(() => this.restCall("PUT", `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`));
    }

    private async connectGateway(handler: IMChannelProvider.BotReplyHandler): Promise<void> {
        while (this.listenerActive) {
            try {
                await this.runGateway(handler);
            } catch (err: any) {
                if (this.listenerActive) {
                    console.error("Discord gateway error:", err);
                }
            }
            if (this.listenerActive) {
                const delay = backoffDelay(this.reconnectAttempts++);
                console.log(`[Discord] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
                await sleep(delay);
            }
        }
    }

    private runGateway(handler: IMChannelProvider.BotReplyHandler): Promise<void> {
        return new Promise((resolve) => {
            const ws = new WebSocket(DISCORD_GATEWAY);
            this.ws = ws;
            this.lastHeartbeatAckAt = Date.now();

            ws.onmessage = (event) => {
                try {
                    const payload = JSON.parse(event.data.toString());
                    const { op, d, s, t } = payload;

                    if (s !== null) this.lastSequence = s;

                    switch (op) {
                        case 10: {
                            const interval = d.heartbeat_interval;
                            this.lastHeartbeatAckAt = Date.now();
                            this.heartbeatInterval = setInterval(() => {
                                try { ws.send(JSON.stringify({ op: 1, d: this.lastSequence })); } catch { }
                            }, interval);
                            // Watchdog: if no ack within 2x the heartbeat interval, the connection is
                            // likely a zombie (network change, sleep, etc.). Force close so the
                            // connectGateway loop reconnects.
                            if (this.heartbeatWatchdog) clearInterval(this.heartbeatWatchdog);
                            this.heartbeatWatchdog = setInterval(() => {
                                if (Date.now() - this.lastHeartbeatAckAt > interval * 2) {
                                    console.warn(`[Discord] Heartbeat ack timeout (${Date.now() - this.lastHeartbeatAckAt}ms), forcing reconnect`);
                                    try { ws.close(); } catch { }
                                }
                            }, Math.max(interval, 5000));

                            ws.send(JSON.stringify({
                                op: 2,
                                d: {
                                    token: this.botToken,
                                    intents: (1 << 0) | (1 << 9) | (1 << 15) | (1 << 12),
                                    properties: {
                                        os: "darwin",
                                        browser: "enconvo",
                                        device: "enconvo",
                                    },
                                },
                            }));
                            break;
                        }
                        case 0: {
                            if (t === "READY") {
                                this.botUserId = d.user?.id || null;
                                this.reconnectAttempts = 0;
                            } else if (t === "MESSAGE_CREATE") {
                                this.handleMessage(d, handler);
                            }
                            break;
                        }
                        case 1: {
                            ws.send(JSON.stringify({ op: 1, d: this.lastSequence }));
                            break;
                        }
                        case 11: {
                            // Heartbeat ACK
                            this.lastHeartbeatAckAt = Date.now();
                            break;
                        }
                        case 7:
                        case 9: {
                            ws.close();
                            break;
                        }
                    }
                } catch {
                    // ignore parse errors
                }
            };

            ws.onclose = () => {
                if (this.heartbeatInterval) {
                    clearInterval(this.heartbeatInterval);
                    this.heartbeatInterval = null;
                }
                if (this.heartbeatWatchdog) {
                    clearInterval(this.heartbeatWatchdog);
                    this.heartbeatWatchdog = null;
                }
                this.ws = null;
                resolve();
            };

            ws.onerror = (err) => {
                console.error("Discord WebSocket error:", err);
                try { ws.close(); } catch { }
            };
        });
    }

    private async handleMessage(d: any, handler: IMChannelProvider.BotReplyHandler): Promise<void> {
        if (d.author?.bot) return;
        if (!this.botUserId) return;

        const isDM = !d.guild_id;
        const mentioned = d.mentions?.some((m: any) => m.id === this.botUserId);

        // Accept DMs always; guild messages only when @mentioned
        if (!isDM && !mentioned) return;

        const hasAttachments = d.attachments && d.attachments.length > 0;

        const channelId = d.channel_id;
        const authorName = d.author?.username || "Unknown";
        const userId = d.author?.id || "";
        const messageId = d.id || "";
        const timestamp = d.timestamp || new Date().toISOString();
        let textContent = d.content || "";
        textContent = textContent.replace(new RegExp(`<@!?${this.botUserId}>`, "g"), "").trim();

        // Download attachments (images, audio, files, etc.)
        const files: string[] = [];
        if (hasAttachments) {
            for (const att of d.attachments) {
                const filePath = await this.downloadAttachment(att);
                if (filePath) files.push(filePath);
            }
            if (!textContent && files.length > 0) {
                const descriptions = d.attachments.map((a: any) => a.filename || "file").join(", ");
                textContent = `[Attachments: ${descriptions}]`;
            }
        }

        // Handle stickers
        if (d.sticker_items && d.sticker_items.length > 0) {
            const stickerNames = d.sticker_items.map((s: any) => s.name || "sticker").join(", ");
            if (!textContent) textContent = `[Sticker: ${stickerNames}]`;
        }

        if (!textContent && files.length === 0) return;

        console.log(`[Discord] Message received: channel=${channelId} author=${authorName} userId=${userId} isDM=${isDM} messageId=${messageId} content="${textContent}" files=${files.length}`);

        // Send typing indicator immediately and keep it alive every 8s
        this.startTyping(channelId);

        const entry = { authorName, content: textContent, channelId, userId, messageId, isDM, timestamp, files: files.length > 0 ? files : undefined };
        const existing = this.pendingBatches.get(channelId);

        if (existing) {
            existing.messages.push(entry);
            clearTimeout(existing.timer);
            existing.timer = setTimeout(() => this.processBatch(channelId, handler), DEBOUNCE_MS);
        } else {
            this.pendingBatches.set(channelId, {
                messages: [entry],
                timer: setTimeout(() => this.processBatch(channelId, handler), DEBOUNCE_MS),
            });
        }
    }

    private async processBatch(channelId: string, handler: IMChannelProvider.BotReplyHandler): Promise<void> {
        const batch = this.pendingBatches.get(channelId);
        if (!batch || batch.messages.length === 0) return;
        this.pendingBatches.delete(channelId);

        const combinedContent = batch.messages
            .map((m) => `${m.authorName}: ${m.content}`)
            .join("\n");

        if (!combinedContent.trim()) return;

        const last = batch.messages[batch.messages.length - 1];

        // Collect all files from the batch
        const allFiles: string[] = [];
        for (const m of batch.messages) {
            if (m.files) allFiles.push(...m.files);
        }

        try {
            await this.restCall("POST", `/channels/${channelId}/typing`, {}).catch(() => {});

            await handler({
                platform: "discord",
                channelId,
                content: combinedContent,
                authorName: batch.messages[0].authorName,
                messageId: last.messageId,
                userId: last.userId,
                isDM: last.isDM,
                timestamp: last.timestamp,
                files: allFiles.length > 0 ? allFiles : undefined,
            });
        } catch (err: any) {
            console.error("Discord message forward error:", err);
        }
    }

    /** Upload a local file to a Discord channel via multipart/form-data */
    private async uploadFile(channelId: string, filePath: string, extraPayload?: any): Promise<any> {
        if (!this.botToken) throw new Error("Discord bot token not configured.");

        const fileBuffer = fs.readFileSync(filePath);
        const fileName = path.basename(filePath);

        const formData = new FormData();
        formData.append("file", new Blob([fileBuffer]), fileName);
        if (extraPayload && Object.keys(extraPayload).length > 0) {
            formData.append("payload_json", JSON.stringify(extraPayload));
        }

        const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
            method: "POST",
            headers: { "Authorization": `Bot ${this.botToken}` },
            body: formData,
        });

        if (!response.ok) {
            const text = await response.text();
            const error: any = new Error(`Discord API error ${response.status}: ${text}`);
            error.status = response.status;
            throw error;
        }

        return response.json();
    }

    private async restCall(method: string, path: string, body?: any): Promise<any> {
        if (!this.botToken) throw new Error("Discord bot token not configured.");

        const options: RequestInit = {
            method,
            headers: {
                "Authorization": `Bot ${this.botToken}`,
                "Content-Type": "application/json",
            },
        };

        if (body && method !== "GET") {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(`${DISCORD_API}${path}`, options);

        if (!response.ok) {
            const text = await response.text();
            const error: any = new Error(`Discord API error ${response.status}: ${text}`);
            error.status = response.status;
            throw error;
        }

        if (response.status === 204) return null;
        return response.json();
    }
}
