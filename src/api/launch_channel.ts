import { ChannelConnectionManager } from "../connection_manager.ts";

interface LaunchChannelParams {
    /** The provider command key (e.g. "im_channels|discord") @required */
    channel_provider: string;
    /** Override: agent command key to bind */
    agent_command_key?: string;
    /** Override: bot token for authentication */
    botToken?: string;
    /** Override: app token (Slack Socket Mode) */
    appToken?: string;
    /** Override: app ID (Feishu) */
    appId?: string;
    /** Override: app secret (Feishu) */
    appSecret?: string;
    /** Override: API domain (Feishu) */
    domain?: string;
}

/**
 * Launch a channel listener for a provider, reading config from preferences or using credential overrides
 * @param {Request} request - Request object, body is {@link LaunchChannelParams}
 * @returns Connection details including id, status, agent binding, and start time
 */
export default async function main(request: Request) {
    console.log("[IM launch_channel] called");
    let params: LaunchChannelParams;
    try {
        params = (await request.json()) as LaunchChannelParams;
    } catch (e: any) {
        console.error("[IM launch_channel] Failed to parse request body:", e.message);
        return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { channel_provider, ...overrides } = params;
    console.log("[IM launch_channel] channel_provider:", channel_provider, "overrides keys:", Object.keys(overrides));

    if (!channel_provider) {
        console.error("[IM launch_channel] Missing channel_provider");
        return Response.json(
            { error: "Missing required field: channel_provider" },
            { status: 400 },
        );
    }

    try {
        const connection = await ChannelConnectionManager.shared().launch(
            channel_provider,
            Object.keys(overrides).length > 0 ? overrides : undefined,
        );
        console.log("[IM launch_channel] result:", connection.status, "channelProvider:", connection.channelProvider, "agent:", connection.agentCommandKey);
        return Response.json({
            success: true,
            connection: {
                id: connection.id,
                channelProvider: connection.channelProvider,
                agentCommandKey: connection.agentCommandKey,
                status: connection.status,
                startedAt: connection.startedAt,
                error: connection.error,
            },
        });
    } catch (err: any) {
        console.error("[IM launch_channel] error:", err.message);
        return Response.json({ error: err.message }, { status: 500 });
    }
}
