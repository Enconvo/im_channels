import { ChannelConnectionManager } from "../connection_manager.ts";

/**
 * List all currently active channel connections from shared state
 * @param {Request} request - Request object (no body required)
 * @returns Active connections array
 */
export default async function main(_request: Request) {
    const connections = ChannelConnectionManager.shared().getAllActive();

    return Response.json({
        success: true,
        connections,
    });
}
