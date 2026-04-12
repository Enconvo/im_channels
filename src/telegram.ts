import { IMChannelProvider } from "@enconvo/api";
import { withRetry, splitMessage, sleep, loadToolsFromSchema } from "./utils.ts";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const TELEGRAM_API = "https://api.telegram.org/bot";
const DOWNLOAD_DIR = path.join(os.homedir(), ".config", "enconvo", "im_channels", "telegram", "inbox");

export default function main(options: IMChannelProvider.Options) {
    return new TelegramProvider(options);
}

export class TelegramProvider extends IMChannelProvider {
    get maxMessageLength() { return 4096; }
    get defaultChannelId() { return this.options.channel_id || null; }

    private botToken: string | null = null;
    private pollingActive = false;
    private lastUpdateId = 0;
    private pollingAbort: AbortController | null = null;
    private typingIntervals = new Map<string, ReturnType<typeof setInterval>>();

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
            if (item.type === "text") {
                const chunks = splitMessage(item.text, this.maxMessageLength);
                for (const chunk of chunks) {
                    await withRetry(() => this.apiCall("sendMessage", {
                        chat_id: channelId,
                        text: chunk,
                        parse_mode: "Markdown",
                    }));
                }
                messageCount += chunks.length;
            } else if (item.type === "voice") {
                await withRetry(() => this.uploadFile(channelId, "sendVoice", "voice", item.url));
                messageCount++;
            } else {
                await withRetry(() => this.uploadFile(channelId, "sendDocument", "document", item.url));
                messageCount++;
            }
        }

        return { messageCount };
    }

    async readMessages(channelId: string, limit = 20): Promise<IMChannelProvider.ChannelMessage[]> {
        const result = await withRetry(() => this.apiCall("getUpdates", {
            limit: Math.min(limit, 100),
            allowed_updates: ["message"],
        }));

        if (!result.ok || !result.result) return [];

        return result.result
            .filter((update: any) => update.message?.chat?.id?.toString() === channelId)
            .map((update: any) => {
                const msg = update.message;
                return {
                    id: msg.message_id.toString(),
                    author: msg.from?.username || msg.from?.first_name || "Unknown",
                    content: msg.text || "",
                    timestamp: new Date(msg.date * 1000).toISOString(),
                    isBot: msg.from?.is_bot || false,
                };
            });
    }

    async startListener(handler: IMChannelProvider.BotReplyHandler): Promise<void> {
        if (this.pollingActive) return;
        this.pollingActive = true;
        this.pollingAbort = new AbortController();

        this.pollLoop(handler);
    }

    async stopListener(): Promise<void> {
        this.pollingActive = false;
        this.pollingAbort?.abort();
        this.pollingAbort = null;
        for (const interval of this.typingIntervals.values()) {
            clearInterval(interval);
        }
        this.typingIntervals.clear();
    }

    async destroy(): Promise<void> {
        await this.stopListener();
    }

    private startTyping(chatId: string): void {
        if (this.typingIntervals.has(chatId)) return;

        const sendAction = () => {
            if (!this.botToken) return;
            fetch(`https://api.telegram.org/bot${this.botToken}/sendChatAction`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, action: "typing" }),
            }).catch(() => { });
        };

        sendAction();
        // Telegram typing expires after ~5s, repeat every 4s
        const interval = setInterval(sendAction, 4000);
        this.typingIntervals.set(chatId, interval);
    }

    stopTyping(chatId: string): void {
        const interval = this.typingIntervals.get(chatId);
        if (interval) {
            clearInterval(interval);
            this.typingIntervals.delete(chatId);
        }
    }

    getTools(): IMChannelProvider.ToolDefinition[] {
        return loadToolsFromSchema("telegram_actions");
    }

    getSystemPromptGuidance(): string {
        return `When replying to an IM message, use the chat_id from the message header. If no chat_id is needed, you can omit it and the default chat is used. Use reply_to with message_id for threaded replies in group chats (not in private chats).`;
    }

    async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
        await withRetry(() => this.apiCall("setMessageReaction", {
            chat_id: channelId,
            message_id: parseInt(messageId),
            reaction: [{ type: "emoji", emoji }],
        }));
    }

    private async pollLoop(handler: IMChannelProvider.BotReplyHandler): Promise<void> {
        while (this.pollingActive) {
            try {
                const result = await this.apiCall("getUpdates", {
                    offset: this.lastUpdateId + 1,
                    timeout: 30,
                    allowed_updates: ["message"],
                });

                if (!result.ok || !result.result) {
                    await sleep(5000);
                    continue;
                }

                for (const update of result.result) {
                    this.lastUpdateId = update.update_id;
                    const msg = update.message;
                    if (!msg || msg.from?.is_bot) continue;

                    const botInfo = await this.getBotInfo();
                    const isPrivateChat = msg.chat.type === "private";

                    // For text messages, check @mention in groups
                    const hasText = !!msg.text;
                    const isMentioned = hasText && botInfo?.username && msg.text.includes(`@${botInfo.username}`);
                    // Accept: private chats always, group messages only when @mentioned
                    const hasMedia = !!(msg.voice || msg.audio || msg.photo || msg.document || msg.sticker || msg.video_note);
                    if (!isPrivateChat && !isMentioned) continue;

                    let textContent = msg.text || msg.caption || "";
                    if (botInfo?.username) {
                        textContent = textContent.replace(new RegExp(`@${botInfo.username}`, "g"), "").trim();
                    }

                    const files: string[] = [];

                    // Handle voice messages
                    if (msg.voice) {
                        const filePath = await this.downloadTelegramFile(msg.voice.file_id, "voice", ".ogg");
                        if (filePath) {
                            files.push(filePath);
                            if (!textContent) textContent = "[Voice message]";
                        }
                    }

                    // Handle audio messages
                    if (msg.audio) {
                        const ext = msg.audio.file_name ? path.extname(msg.audio.file_name) : ".mp3";
                        const filePath = await this.downloadTelegramFile(msg.audio.file_id, "audio", ext);
                        if (filePath) {
                            files.push(filePath);
                            if (!textContent) textContent = `[Audio: ${msg.audio.title || msg.audio.file_name || "audio"}]`;
                        }
                    }

                    // Handle photo messages (get largest size)
                    if (msg.photo && msg.photo.length > 0) {
                        const largest = msg.photo[msg.photo.length - 1];
                        const filePath = await this.downloadTelegramFile(largest.file_id, "photo", ".jpg");
                        if (filePath) {
                            files.push(filePath);
                            if (!textContent) textContent = "[Photo]";
                        }
                    }

                    // Handle document/file messages
                    if (msg.document) {
                        const ext = msg.document.file_name ? path.extname(msg.document.file_name) : "";
                        const filePath = await this.downloadTelegramFile(msg.document.file_id, "doc", ext);
                        if (filePath) {
                            files.push(filePath);
                            if (!textContent) textContent = `[Document: ${msg.document.file_name || "file"}]`;
                        }
                    }

                    // Handle video notes (round video messages)
                    if (msg.video_note) {
                        const filePath = await this.downloadTelegramFile(msg.video_note.file_id, "videonote", ".mp4");
                        if (filePath) {
                            files.push(filePath);
                            if (!textContent) textContent = "[Video note]";
                        }
                    }

                    // Handle stickers
                    if (msg.sticker) {
                        textContent = `[Sticker: ${msg.sticker.emoji || ""} ${msg.sticker.set_name || ""}]`.trim();
                    }

                    if (!textContent && files.length === 0) continue;

                    // Start typing immediately
                    this.startTyping(msg.chat.id.toString());

                    try {
                        await handler({
                            platform: "telegram",
                            channelId: msg.chat.id.toString(),
                            content: textContent,
                            authorName: msg.from?.username || msg.from?.first_name || "Unknown",
                            messageId: msg.message_id?.toString(),
                            userId: msg.from?.id?.toString(),
                            isDM: isPrivateChat,
                            timestamp: new Date(msg.date * 1000).toISOString(),
                            files: files.length > 0 ? files : undefined,
                        });
                    } catch (err: any) {
                        console.error("Telegram message forward error:", err);
                    }
                }
            } catch (err: any) {
                if (this.pollingActive) {
                    console.error("Telegram polling error:", err);
                    await sleep(5000);
                }
            }
        }
    }

    /** Download a Telegram file by file_id to local disk, return the local path */
    private async downloadTelegramFile(fileId: string, prefix: string, ext: string): Promise<string | null> {
        try {
            const fileInfo = await this.apiCall("getFile", { file_id: fileId });
            if (!fileInfo.ok || !fileInfo.result?.file_path) return null;

            const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${fileInfo.result.file_path}`;
            const resp = await fetch(fileUrl);
            if (!resp.ok) return null;

            if (!fs.existsSync(DOWNLOAD_DIR)) {
                fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
            }

            const fileName = `${prefix}_${Date.now()}${ext}`;
            const localPath = path.join(DOWNLOAD_DIR, fileName);
            const buffer = Buffer.from(await resp.arrayBuffer());
            fs.writeFileSync(localPath, buffer);

            console.log(`[Telegram] Downloaded file: ${localPath} (${buffer.length} bytes)`);
            return localPath;
        } catch (err: any) {
            console.error(`[Telegram] Failed to download file ${fileId}:`, err.message);
            return null;
        }
    }

    private botInfoCache: any = null;

    private async getBotInfo(): Promise<any> {
        if (this.botInfoCache) return this.botInfoCache;
        const result = await this.apiCall("getMe", {});
        if (result.ok) {
            this.botInfoCache = result.result;
        }
        return this.botInfoCache;
    }

    /** Upload a local file to Telegram via multipart/form-data */
    private async uploadFile(chatId: string, method: string, fieldName: string, filePath: string): Promise<any> {
        if (!this.botToken) throw new Error("Telegram bot token not configured.");

        const fileBuffer = fs.readFileSync(filePath);
        const fileName = path.basename(filePath);

        const formData = new FormData();
        formData.append("chat_id", chatId);
        formData.append(fieldName, new Blob([fileBuffer]), fileName);

        const response = await fetch(`${TELEGRAM_API}${this.botToken}/${method}`, {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            const body = await response.text();
            const error: any = new Error(`Telegram API error ${response.status}: ${body}`);
            error.status = response.status;
            throw error;
        }

        return response.json();
    }

    private async apiCall(method: string, params: Record<string, any>): Promise<any> {
        if (!this.botToken) throw new Error("Telegram bot token not configured.");

        const response = await fetch(`${TELEGRAM_API}${this.botToken}/${method}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
            signal: this.pollingAbort?.signal,
        });

        if (!response.ok) {
            const body = await response.text();
            const error: any = new Error(`Telegram API error ${response.status}: ${body}`);
            error.status = response.status;
            throw error;
        }

        return response.json();
    }
}
