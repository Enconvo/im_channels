import { CommandManageUtils, NativeAPI, NativeEventUtils, IMChannelProvider, ServiceProvider } from "@enconvo/api";
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

    private createHandler(connection: ActiveConnection): (msg: IMChannelProvider.IncomingMessage) => Promise<void> {
        return async (msg: IMChannelProvider.IncomingMessage) => {
            console.log(`[IM] ← Received: ${connection.channelProvider}/${msg.channelId} from ${msg.authorName}: ${msg.content.substring(0, 200)}`, msg);

            console.log(`[IM]   Forwarding to agent: ${connection.agentCommandKey} (fire-and-forget)`);

            // Fire-and-forget: don't await, let agent process independently
            const headerParts = [
                `channel_provider: ${connection.channelProvider}`,
                `sender: ${msg.authorName}`,
                `channel_id: ${msg.channelId}`,
            ];
            if (msg.userId) headerParts.push(`user_id: ${msg.userId}`);
            // In DMs, skip message_id so agent sends a plain message instead of a reply
            if (msg.messageId && !msg.isDM) headerParts.push(`message_id: ${msg.messageId}`);
            if (msg.isDM != null) headerParts.push(`is_dm: ${msg.isDM}`);

            const inputText = `[IM message from ${headerParts.join(", ")}]\n${msg.content}`;
            const agentParams: any = {
                agentId: connection.agentCommandKey,
                input_text: inputText,
                context_metadata: {
                    source: "im_channel",
                    channel_provider: connection.channelProvider,
                    channel_id: msg.channelId,
                    author: msg.authorName,
                    user_id: msg.userId,
                    message_id: msg.messageId,
                    is_dm: msg.isDM,
                },
            };
            // Pass attached files (voice, photo, document, etc.) to the agent
            if (msg.files && msg.files.length > 0) {
                agentParams.context_files = msg.files;
            }
            NativeAPI.localApi("agent/messages", agentParams).then((resp) => {
                console.log(`[IM] → Agent responded: ${connection.agentCommandKey}, status: ${resp.status}`);
                // Stop typing in THIS Worker where the intervals live
                if ((connection.provider as any).stopTyping) {
                    (connection.provider as any).stopTyping(msg.channelId);
                }
            }).catch((err: any) => {
                console.error(`[IM] ✗ Agent forward failed: ${connection.agentCommandKey}:`, err.message);
                // Stop typing on error too
                if ((connection.provider as any).stopTyping) {
                    (connection.provider as any).stopTyping(msg.channelId);
                }
            });
        };
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
