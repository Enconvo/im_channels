import { ChannelConnectionManager } from "../connection_manager.ts";

/**
 * Restore all enabled channels, called on app startup or manually
 * @param {Request} request - Request object (no body required)
 * @returns Count of restored channels and their connection details
 */
export default async function main(_request: Request) {
    console.log("[IM restore_channels] called");
    await ChannelConnectionManager.shared().restoreAll();
    const active = ChannelConnectionManager.shared().getAllActive();
    console.log("[IM restore_channels] restored", active.length, "channel(s)");
    return Response.json({
        success: true,
        restored: active.length,
        connections: active,
    });
}
