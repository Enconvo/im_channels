import { CommandManageUtils, NativeAPI, NativeEventUtils, IMChannelProvider, ServiceProvider, RequestOptions, Runtime, TTSProvider, DictationProvider, PreferenceManageUtils } from "@enconvo/api";
import { splitTextForTTS } from "./utils.ts";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface ActiveConnection {
    id: string;
    channelProvider: string;
    agentCommandKey: string;
    status: "connecting" | "active" | "error";
    startedAt: string;
    error?: string;
    provider: IMChannelProvider;
}

interface ConnectionRecord {
    id: string;
    channelProvider: string;
    agentCommandKey: string;
    status: string;
    startedAt: string;
    error?: string;
    pid: number;
}

interface ProviderConfig {
    enabled?: boolean;
    bound_agent?: string;
    agent_command_key?: string;
    botToken?: string;
    [key: string]: any;
}

interface AccessControl {
    policy: "pairing" | "open";
    allowList: { userId: string; username?: string; firstName?: string; chatId: string; approvedAt: number }[];
    pending: { code: string; userId: string; username?: string; firstName?: string; chatId: string; createdAt: number }[];
}

const DEFAULT_ACCESS: AccessControl = { policy: "open", allowList: [], pending: [] };

function generatePairingCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 8; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

function normalizeAccess(val: any): AccessControl {
    if (!val || Array.isArray(val) || typeof val !== "object") return { ...DEFAULT_ACCESS };
    return {
        policy: val.policy === "pairing" ? "pairing" : "open",
        allowList: Array.isArray(val.allowList) ? val.allowList : [],
        pending: Array.isArray(val.pending) ? val.pending : [],
    };
}

const STATE_DIR = path.join(os.homedir(), ".config", "enconvo", "im_channels");
const STATE_FILE = path.join(STATE_DIR, "active_connections.json");

const GLOBAL_KEY = "__im_channel_connection_manager__";

/**
 * Manages active channel connections.
 * Uses file-based state to share connection info across Worker threads.
 * Singleton stored on globalThis to survive module re-evaluations within the same Worker.
 */
class ChannelConnectionManager {
    private connections = new Map<string, ActiveConnection>();
    private shutdownRegistered = false;
    /** Active agent request AbortControllers keyed by channelId */
    private activeRequests = new Map<string, AbortController>();

    static shared(): ChannelConnectionManager {
        if (!(globalThis as any)[GLOBAL_KEY]) {
            (globalThis as any)[GLOBAL_KEY] = new ChannelConnectionManager();
        }
        return (globalThis as any)[GLOBAL_KEY];
    }

    private registerShutdownHooks(): void {
        if (this.shutdownRegistered) return;
        this.shutdownRegistered = true;

        const shutdown = () => {
            console.log("[IM] Process exiting, stopping all channels...");
            for (const conn of this.connections.values()) {
                try {
                    conn.provider.stopListener();
                } catch { }
            }
            this.connections.clear();
            // Clean state file so stale records don't linger
            try {
                const records = this.loadState().filter(r => r.pid !== process.pid);
                this.ensureDir();
                fs.writeFileSync(STATE_FILE, JSON.stringify(records, null, 2));
            } catch { }
        };

        process.on("SIGTERM", shutdown);
        process.on("SIGINT", shutdown);
        process.on("exit", shutdown);
    }

    async launch(channelProvider: string): Promise<ActiveConnection> {
        this.registerShutdownHooks();

        // Check if already launched in this Worker
        if (this.connections.has(channelProvider)) {
            const existing = this.connections.get(channelProvider)!;
            if (existing.status === "active" || existing.status === "connecting") {
                return existing;
            }
        }

        // Cross-Worker dedup: check state file for an alive connection from another Worker
        const existingRecord = this.loadState().find(r => r.channelProvider === channelProvider);
        if (existingRecord && existingRecord.pid !== process.pid && this.isProcessAlive(existingRecord.pid)) {
            console.log(`[IM] Channel ${channelProvider} already launched by Worker PID ${existingRecord.pid}, skipping`);
            return {
                id: existingRecord.id,
                channelProvider: existingRecord.channelProvider,
                agentCommandKey: existingRecord.agentCommandKey,
                status: existingRecord.status as any,
                startedAt: existingRecord.startedAt,
                error: existingRecord.error,
                provider: null as any,
            };
        }

        // Build config: merge preferences with overrides
        let config: ProviderConfig = {};
        try {
            const savedConfig = await CommandManageUtils.loadCommandConfig({
                commandKey: channelProvider,
                decrypt: true,
            }) as ProviderConfig | null;
            if (savedConfig) config = savedConfig;
        } catch {
            // Preferences might not be available (e.g. direct API call)
        }

        const agentCommandKey = config.bound_agent;
        if (!agentCommandKey) {
            throw new Error(`No agent bound to provider ${channelProvider}`);
        }

        // Ensure ServiceProvider.load can find the JS file
        config.commandKey = channelProvider;
        const rawCommand = CommandManageUtils.getRawCommandInfo(channelProvider);
        if (rawCommand?.targetCommand) {
            config.targetCommand = rawCommand.targetCommand;
        }

        // Use ServiceProvider.load() — the standard Enconvo provider pattern
        const provider: IMChannelProvider = ServiceProvider.load(config);

        if (!provider.isReady()) {
            throw new Error(`Provider for ${channelProvider} is not ready (missing credentials?)`);
        }

        const connection: ActiveConnection = {
            id: channelProvider,
            channelProvider,
            agentCommandKey,
            status: "connecting",
            startedAt: new Date().toISOString(),
            provider,
        };

        this.connections.set(channelProvider, connection);

        const handler = this.createHandler(connection);

        try {
            await provider.startListener(handler);
            connection.status = "active";
            console.log(`[IM] Launched channel: ${channelProvider} → agent ${agentCommandKey}`);
        } catch (err: any) {
            connection.status = "error";
            connection.error = err.message;
            console.error(`[IM] Failed to launch channel ${channelProvider}:`, err);
        }

        // Persist to shared state file
        this.saveState(connection);
        this.emitStatusEvent(connection);

        return connection;
    }

    async stop(channelProvider: string): Promise<void> {
        const connection = this.connections.get(channelProvider);
        if (connection) {
            try {
                await connection.provider.stopListener();
                await connection.provider.destroy();
            } catch (err: any) {
                console.error(`[IM] Error stopping channel ${channelProvider}:`, err);
            }
            this.connections.delete(channelProvider);
        }

        // Remove from shared state file
        this.removeState(channelProvider);
        this.emitStatusEvent({
            channelProvider,
            status: "stopped",
        });
        console.log(`[IM] Stopped channel: ${channelProvider}`);
    }

    /** Get connections from this Worker's memory */
    getLocalActive(): ActiveConnection[] {
        return Array.from(this.connections.values());
    }

    /** Get all connections from shared state file (cross-Worker) */
    getAllActive(): ConnectionRecord[] {
        return this.loadState();
    }

    isLaunched(channelProvider: string): boolean {
        const conn = this.connections.get(channelProvider);
        if (conn && (conn.status === "active" || conn.status === "connecting")) {
            return true;
        }
        const records = this.loadState();
        return records.some(r => r.channelProvider === channelProvider);
    }

    async restoreAll(): Promise<void> {
        this.cleanStaleRecords();
        console.log("[IM] Restoring all enabled channels...");
        try {
            const results = (await NativeAPI.localApi("search/providers", {
                category: "im_channel",
            } as any).then(r => r.json())) as any[];
            console.log('restore all results', results);

            if (!Array.isArray(results)) return;

            for (const item of results) {
                try {
                    const config = await CommandManageUtils.loadCommandConfig({
                        commandKey: item.commandKey,
                        decrypt: true,
                    }) as ProviderConfig | null;

                    if (!config?.enabled || !config?.bound_agent) continue;
                    await this.launch(item.commandKey);
                } catch (err: any) {
                    console.error(`[IM] Failed to restore channel ${item.commandKey}:`, err);
                }
            }
        } catch (err: any) {
            console.error("[IM] Failed to restore channels:", err);
        }
        console.log(`[IM] Restored ${this.connections.size} channel(s).`);
    }

    /**
     * Detect voice/audio attachments in an incoming message and transcribe them to English text.
     * Returns the effective input text (transcript replaces `[Voice message]` placeholder, or is
     * appended to any existing caption) along with the non-voice files that should still be passed
     * to the agent as context.
     */
    private async transcribeVoiceFiles(
        msg: IMChannelProvider.IncomingMessage,
    ): Promise<{ inputText: string; remainingFiles: string[] }> {
        const VOICE_EXTS = new Set([".ogg", ".oga", ".opus", ".mp3", ".wav", ".m4a", ".aac", ".webm"]);
        const files = msg.files ?? [];
        const voiceFiles = files.filter((f) => VOICE_EXTS.has(path.extname(f).toLowerCase()));
        const remainingFiles = files.filter((f) => !VOICE_EXTS.has(path.extname(f).toLowerCase()));

        if (voiceFiles.length === 0) {
            return { inputText: msg.content, remainingFiles };
        }

        const dictationProvider = await DictationProvider.fromEnv();
        const transcripts: string[] = [];
        for (const audioFilePath of voiceFiles) {
            try {
                const result = await dictationProvider.audioToText({ audioFilePath });
                if (result?.text?.trim()) transcripts.push(result.text.trim());
                console.log(`[IM]   Transcribed voice: ${audioFilePath} → ${result?.text?.slice(0, 200)}`);
            } catch (err: any) {
                console.error(`[IM] ✗ Voice transcription failed for ${audioFilePath}:`, err.message);
            }
        }

        const transcribed = transcripts.join("\n");
        const caption = msg.content?.trim();
        const isPlaceholder = !caption || caption === "[Voice message]" || caption === "[Video note]";
        const inputText = transcribed
            ? (isPlaceholder ? transcribed : `${caption}\n${transcribed}`)
            : msg.content;

        return { inputText, remainingFiles };
    }

    private createHandler(connection: ActiveConnection): (msg: IMChannelProvider.IncomingMessage) => Promise<void> {
        return async (msg: IMChannelProvider.IncomingMessage) => {
            console.log(`[IM] ← Received: ${connection.channelProvider}/${msg.channelId} from ${msg.authorName}: ${msg.content.substring(0, 200)}`, msg);

            // Access control gate — unapproved users get a pairing code instead of agent access.
            // All messages (including bot commands) require authorization first.
            const allowed = await this.checkAccess(connection, msg);
            if (!allowed) {
                if ((connection.provider as any).stopTyping) {
                    (connection.provider as any).stopTyping(msg.channelId);
                }
                return;
            }

            // Handle bot commands before forwarding to agent. These reply synchronously
            // (no agent invocation) so we must stop any typing indicator the provider
            // started on message arrival.
            const [cmdName, ...cmdArgs] = msg.content.trim().toLowerCase().split(/\s+/);
            const isBotCommand =
                cmdName === "/new" || cmdName === "/newsession" ||
                cmdName === "/stop" ||
                cmdName === "/audio" ||
                cmdName === "/status";
            if (isBotCommand) {
                try {
                    if (cmdName === "/new" || cmdName === "/newsession") {
                        await this.handleNewSessionCommand(connection, msg);
                    } else if (cmdName === "/stop") {
                        await this.handleStopCommand(connection, msg);
                    } else if (cmdName === "/audio") {
                        await this.handleToggleAudioCommand(connection, msg, cmdArgs[0]);
                    } else if (cmdName === "/status") {
                        await this.handleStatusCommand(connection, msg);
                    }
                } finally {
                    if ((connection.provider as any).stopTyping) {
                        (connection.provider as any).stopTyping(msg.channelId);
                    }
                }
                return;
            }

            const isAgentMode = await Runtime.isCommandAgentMode(connection.agentCommandKey)

            const commandConfig = await CommandManageUtils.loadCommandConfig({ commandKey: connection.agentCommandKey, includes: ['auto_audio_play'] })


            console.log(`[IM]   Forwarding to agent: ${connection.agentCommandKey}, agentMode: ${isAgentMode}`);

            const { inputText, remainingFiles } = await this.transcribeVoiceFiles(msg);
            const agentParams: RequestOptions = {
                agentId: connection.agentCommandKey,
                invoke_source: `${connection.channelProvider}-${msg.channelId}`,
                context_items: [
                    {
                        source: "im_channel",
                        type: "im_message",
                        title: inputText?.slice(0, 10),
                        content: inputText,
                        channel_provider: connection.channelProvider,
                        channel_id: msg.channelId,
                        author: msg.authorName,
                        status: 'content_loaded',
                        user_id: msg.userId,
                        message_id: msg.messageId,
                        is_dm: msg.isDM,
                    }
                ],
            };

            // Pass attached files (photo, document, etc.) to the agent — voice files were transcribed above
            if (remainingFiles.length > 0) {
                agentParams.context_files = remainingFiles;
            }

            // Create an AbortController so /stop can cancel this request
            const abortController = new AbortController();
            this.activeRequests.set(msg.channelId, abortController);

            if (isAgentMode) {
                // Agent mode: fire-and-forget — the agent will use IM tools to reply
                NativeAPI.localApi("agent/messages", agentParams, { signal: abortController.signal }).then(async (resp) => {
                    const json = await resp.json()
                    console.log(`[IM] → Agent responded: ${connection.agentCommandKey}, status: ${resp.status}`, json);

                    // If the agent response contains only text content, it didn't use IM tools to reply — send it ourselves
                    const textReply = this.extractTextOnlyReply(json);
                    if (textReply) {
                        await connection.provider.sendMessage(msg.channelId, [{ type: "text", text: textReply }], { replyTo: msg.messageId });
                        console.log(`[IM] → Sent text-only agent reply to ${connection.channelProvider}/${msg.channelId}`);
                    }

                    if ((connection.provider as any).stopTyping) {
                        (connection.provider as any).stopTyping(msg.channelId);
                    }

                }).catch(async (err: any) => {
                    if (abortController.signal.aborted) {
                        console.log(`[IM] Agent request aborted: ${connection.agentCommandKey}/${msg.channelId}`);
                    } else {
                        console.error(`[IM] ✗ Agent forward failed: ${connection.agentCommandKey}:`, err.message);
                        await connection.provider.sendMessage(msg.channelId, [{ type: "text", text: `❌ Error: ${err.message}` }]);
                    }
                    if ((connection.provider as any).stopTyping) {
                        (connection.provider as any).stopTyping(msg.channelId);
                    }
                }).finally(() => {
                    this.activeRequests.delete(msg.channelId);
                });
            } else {
                // Non-agent (chat) mode: await response and send result back to IM
                try {
                    const resp = await NativeAPI.localApi("agent/messages", agentParams, { abortController });

                    if (abortController.signal.aborted) return;

                    const replyText = await this.extractResponseText(resp);
                    console.log(`[IM] → Agent responded: ${connection.agentCommandKey}, status: ${resp.status} replyText:${replyText}`);
                    if (replyText) {
                        await connection.provider.sendMessage(msg.channelId, [{ type: "text", text: replyText }], { replyTo: msg.messageId });
                        console.log(`[IM] → Sent text reply to ${connection.channelProvider}/${msg.channelId}`);

                        if (commandConfig?.['auto_audio_play'] === true) {
                            // Stream TTS: split into sentence chunks, generate & send each as it's ready
                            const tts = await TTSProvider.fromEnv();
                            const ttsChunks = splitTextForTTS(replyText);
                            if (ttsChunks.length > 0 && (connection.provider as any).startTyping) {
                                (connection.provider as any).startTyping(msg.channelId);
                            }
                            for (const chunk of ttsChunks) {
                                if (abortController.signal.aborted) break;
                                const ttsItem = await tts.toFile({ text: chunk });
                                if (ttsItem.path) {
                                    await connection.provider.sendMessage(msg.channelId, [{ type: "voice", url: ttsItem.path }]);
                                }
                            }
                            console.log(`[IM] → Sent ${ttsChunks.length} TTS voice chunk(s) to ${connection.channelProvider}/${msg.channelId}`);
                        }
                    }
                } catch (err: any) {
                    if (abortController.signal.aborted) {
                        console.log(`[IM] Agent request aborted: ${connection.agentCommandKey}/${msg.channelId}`);
                    } else {
                        console.error(`[IM] ✗ Agent forward failed: ${connection.agentCommandKey}:`, err.message);
                        await connection.provider.sendMessage(msg.channelId, [{ type: "text", text: `❌ Error: ${err.message}` }]);
                    }
                } finally {
                    this.activeRequests.delete(msg.channelId);
                    if ((connection.provider as any).stopTyping) {
                        (connection.provider as any).stopTyping(msg.channelId);
                    }
                }
            }
        };
    }

    private async checkAccess(connection: ActiveConnection, msg: IMChannelProvider.IncomingMessage): Promise<boolean> {
        try {
            const config = await CommandManageUtils.loadCommandConfig({
                commandKey: connection.channelProvider,
                includes: ["access"],
            });
            const access = normalizeAccess(config?.access);
            if (access.policy === "open") return true;

            const userId = msg.userId;
            if (!userId) return false;

            if (access.allowList.some(e => e.userId === userId)) return true;

            if (access.pending.some(e => e.userId === userId)) {
                await connection.provider.sendMessage(msg.channelId, [
                    { type: "text", text: "⏳ Your access request is pending approval." },
                ]);
                return false;
            }

            const code = generatePairingCode();
            access.pending.push({
                code,
                userId,
                username: msg.authorName,
                firstName: msg.authorName,
                chatId: msg.channelId,
                createdAt: Date.now(),
            });

            await PreferenceManageUtils.updatePreference({
                keys: ["access"],
                value: access,
                preferenceKey: connection.channelProvider,
            });

            const channelName = connection.channelProvider.split("|").pop() || "unknown";
            const platformLabel = channelName.replace("_channel", "");
            const platformTitle = platformLabel.charAt(0).toUpperCase() + platformLabel.slice(1);
            console.log(`[IM] Access: generated pairing code ${code} for user ${userId} (${msg.authorName})`);
            const pairingMsg = [
                `Enconvo: access not configured.`,
                ``,
                `Your ${platformTitle} user id: ${userId}`,
                `Pairing code:`,
                ``,
                `\`\`\`${code}\`\`\``,
                ``,
                `Ask the bot owner to approve with:`,
                ``,
                `\`\`\`copy\nenconvo im_channels pairing approve --channel ${channelName} --code ${code}\n\`\`\``,
            ].join("\n");
            await connection.provider.sendMessage(msg.channelId, [
                { type: "text", text: pairingMsg },
            ]);
            return false;
        } catch (err: any) {
            console.error("[IM] Access check failed:", err.message);
            return true;
        }
    }

    private async handleNewSessionCommand(connection: ActiveConnection, msg: IMChannelProvider.IncomingMessage): Promise<void> {
        try {
            const resp = await NativeAPI.localApi("agent/new_session", {
                agentId: connection.agentCommandKey,
                invokeSource: `${connection.channelProvider}-${msg.channelId}`
            });
            const session = await resp.json() as any;
            if (session?.commandKey) {
                console.log(`[IM] New session created: ${session.commandKey} for ${connection.channelProvider}/${msg.channelId}/${msg.userId}/${msg.authorName}`);
                await connection.provider.sendMessage(msg.channelId, [{ type: "text", text: "✅ New session started." }]);
            } else {
                await connection.provider.sendMessage(msg.channelId, [{ type: "text", text: "❌ Failed to create new session." }]);
            }
        } catch (err: any) {
            console.error(`[IM] /new command failed:`, err.message);
            await connection.provider.sendMessage(msg.channelId, [{ type: "text", text: `❌ Error: ${err.message}` }]);
        }
    }

    private async handleStopCommand(connection: ActiveConnection, msg: IMChannelProvider.IncomingMessage): Promise<void> {
        const controller = this.activeRequests.get(msg.channelId);
        if (controller) {
            controller.abort();
            this.activeRequests.delete(msg.channelId);
            if ((connection.provider as any).stopTyping) {
                (connection.provider as any).stopTyping(msg.channelId);
            }
            console.log(`[IM] /stop command: aborted active request for ${connection.channelProvider}/${msg.channelId}`);
            await connection.provider.sendMessage(msg.channelId, [{ type: "text", text: "⏹ Stopped." }]);
        } else {
            await connection.provider.sendMessage(msg.channelId, [{ type: "text", text: "No active request to stop." }]);
        }
    }

    /**
     * Toggle the agent's `auto_audio_play` preference (TTS audio reply).
     * Accepts `/audio on`, `/audio off`, or `/audio` (toggle).
     * Persists via PreferenceManageUtils so the change survives across requests.
     */
    private async handleToggleAudioCommand(connection: ActiveConnection, msg: IMChannelProvider.IncomingMessage, arg?: string): Promise<void> {
        try {
            const config = await CommandManageUtils.loadCommandConfig({
                commandKey: connection.agentCommandKey,
                includes: ["auto_audio_play"],
            });
            const current = config?.["auto_audio_play"] === true;
            const next = arg === "on" ? true : arg === "off" ? false : !current;
            await PreferenceManageUtils.updatePreference({
                keys: ["auto_audio_play"],
                value: next,
                preferenceKey: connection.agentCommandKey,
            });
            const status = next ? "🔊 Audio reply enabled" : "🔇 Audio reply disabled";
            console.log(`[IM] /audio command: ${connection.agentCommandKey} auto_audio_play → ${next}`);
            await connection.provider.sendMessage(msg.channelId, [{ type: "text", text: status }]);
        } catch (err: any) {
            console.error(`[IM] /audio command failed:`, err.message);
            await connection.provider.sendMessage(msg.channelId, [{ type: "text", text: `❌ Error: ${err.message}` }]);
        }
    }

    /**
     * Show the current LLM provider + model configured on the bound agent.
     */
    private async handleStatusCommand(connection: ActiveConnection, msg: IMChannelProvider.IncomingMessage): Promise<void> {
        try {
            const config = await CommandManageUtils.loadCommandConfig({
                commandKey: connection.agentCommandKey,
                includes: ["llm", "auto_audio_play", 'title'],
                useAsRunParams: true
            }) as any;
            const llm = config?.llm;
            const providerTitle = llm?.title || llm?.commandName || "(not configured)";
            const modelTitle = llm?.modelName?.title || llm?.modelName?.value || "(not configured)";
            const audioReply = config?.auto_audio_play === true ? "on" : "off";
            const text = [
                `🤖 Name: ${config.title}`,
                `🤖 AgentId: ${connection.agentCommandKey}`,
                `🧠 Provider: ${providerTitle}`,
                `🎯 Model: ${modelTitle}`,
                `🔊 Audio reply: ${audioReply}`,
            ].join("\n");
            await connection.provider.sendMessage(msg.channelId, [{ type: "text", text }]);
        } catch (err: any) {
            console.error(`[IM] /status command failed:`, err.message);
            await connection.provider.sendMessage(msg.channelId, [{ type: "text", text: `❌ Error: ${err.message}` }]);
        }
    }

    /**
     * If the agent response is `{ type: "messages", messages: [{ content: [...] }] }`
     * and every content item is `type: "text"`, return the joined text.
     * Otherwise return null (the agent used tools like IM reply to send the message itself).
     */
    private extractTextOnlyReply(json: any): string | null {
        if (json?.type !== "messages" || !Array.isArray(json.messages)) return null;

        const texts: string[] = [];
        for (const message of json.messages) {
            if (message.role !== "assistant") continue;
            const contents = Array.isArray(message.content) ? message.content : [];
            if (contents.length === 0) continue;
            // If any content item is not text, the agent handled delivery itself
            if (contents.some((c: any) => c.type !== "text")) return null;
            for (const c of contents) {
                if (c.text) texts.push(c.text);
            }
        }
        return texts.length > 0 ? texts.join("\n") : null;
    }

    private async extractResponseText(resp: Response): Promise<string | null> {
        try {
            const body = await resp.json();
            if (typeof body === "string") return body;
            if (body?.type === "text" && typeof body.content === "string") return body.content;
            if (body?.type === "messages" && Array.isArray(body.messages)) {
                const texts: string[] = [];
                for (const message of body.messages) {
                    const contents = Array.isArray(message.content) ? message.content : [];
                    for (const c of contents) {
                        if (c.type === "text" && c.text) texts.push(c.text);
                    }
                }
                return texts.join("\n") || null;
            }
        } catch (err) {
            console.error("[IM] Failed to parse agent response:", err);
        }
        return null;
    }

    private emitStatusEvent(info: { channelProvider: string; status: string; error?: string }): void {
        NativeEventUtils.sendEvent("im_channel_status_changed", {
            channelProvider: info.channelProvider,
            status: info.status,
            error: info.error,
        }).catch(() => { });
    }

    private isProcessAlive(pid: number): boolean {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    }

    private cleanStaleRecords(): void {
        const records = this.loadState();
        const alive = records.filter(r => this.isProcessAlive(r.pid));
        if (alive.length !== records.length) {
            console.log(`[IM] Cleaned ${records.length - alive.length} stale connection record(s)`);
            this.ensureDir();
            fs.writeFileSync(STATE_FILE, JSON.stringify(alive, null, 2));
        }
    }

    // --- File-based state management ---

    private ensureDir(): void {
        if (!fs.existsSync(STATE_DIR)) {
            fs.mkdirSync(STATE_DIR, { recursive: true });
        }
    }

    private loadState(): ConnectionRecord[] {
        try {
            if (!fs.existsSync(STATE_FILE)) return [];
            const data = fs.readFileSync(STATE_FILE, "utf-8");
            return JSON.parse(data) as ConnectionRecord[];
        } catch {
            return [];
        }
    }

    private saveState(connection: ActiveConnection): void {
        this.ensureDir();
        const records = this.loadState();

        const idx = records.findIndex(r => r.channelProvider === connection.channelProvider);
        const record: ConnectionRecord = {
            id: connection.id,
            channelProvider: connection.channelProvider,
            agentCommandKey: connection.agentCommandKey,
            status: connection.status,
            startedAt: connection.startedAt,
            error: connection.error,
            pid: process.pid,
        };

        if (idx >= 0) {
            records[idx] = record;
        } else {
            records.push(record);
        }

        fs.writeFileSync(STATE_FILE, JSON.stringify(records, null, 2));
    }

    private removeState(channelProvider: string): void {
        const records = this.loadState();
        const filtered = records.filter(r => r.channelProvider !== channelProvider);
        this.ensureDir();
        fs.writeFileSync(STATE_FILE, JSON.stringify(filtered, null, 2));
    }
}

export { ChannelConnectionManager };
