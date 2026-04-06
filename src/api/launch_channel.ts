import { PreferenceManageUtils } from "@enconvo/api";
import { ChannelConnectionManager } from "../connection_manager.ts";

interface LaunchChannelParams {
    /** The provider command key (e.g. "im_channels|discord") @required */
    channel_provider: string;
    /** The agent command key to bind to this channel (e.g. "chat_with_ai|chat_command"). If provided, the channel's bound_agent preference will be set automatically. */
    bound_agent?: string;
    /** The bot token for the platform (e.g. Discord Bot Token, Telegram Bot API Token). Will be set as the botToken preference on the new channel. */
    botToken?: string;
    /** Whether to enable real-time message listening for this channel @default false */
    enabled?: boolean;
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

    const { channel_provider, bound_agent, botToken, enabled } = params;
    console.log("[IM launch_channel] channel_provider:", channel_provider);

    if (!channel_provider) {
        console.error("[IM launch_channel] Missing channel_provider");
        return Response.json(
            { error: "Missing required field: channel_provider" },
            { status: 400 },
        );
    }

    // Save provided params to config before launching
    const prefsToSet: { keys: string[]; value: any }[] = [];
    if (bound_agent) prefsToSet.push({ keys: ["bound_agent"], value: bound_agent });
    if (botToken) prefsToSet.push({ keys: ["botToken"], value: botToken });
    if (enabled !== undefined) prefsToSet.push({ keys: ["enabled"], value: enabled });

    for (const pref of prefsToSet) {
        try {
            await PreferenceManageUtils.updatePreference({
                ...pref,
                preferenceKey: channel_provider,
            });
        } catch (err: any) {
            console.error(`[IM launch_channel] Failed to set ${pref.keys[0]}:`, err.message);
        }
    }

    try {
        const connection = await ChannelConnectionManager.shared().launch(
            channel_provider,
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
