import { NativeAPI, PreferenceManageUtils } from "@enconvo/api";

interface CreateChannelParams {
    /** The platform name (e.g. "discord", "telegram") @required */
    platform: string;
    /** Custom title for the new channel (e.g. "Sensei English Bot"). If omitted, auto-generates "Discord 2", "Telegram 3", etc. */
    title?: string;
    /** The agent command key to bind to this channel (e.g. "chat_with_ai|chat_command"). If provided, the channel's bound_agent preference will be set automatically. */
    bound_agent?: string;
    /** The bot token for the platform (e.g. Discord Bot Token, Telegram Bot API Token). Will be set as the botToken preference on the new channel. */
    botToken?: string;
    /** Whether to enable real-time message listening for this channel @default false */
    enabled?: boolean;
}

/**
 * Create a new channel by duplicating the base provider command for a platform
 * @param {Request} request - Request object, body is {@link CreateChannelParams}
 * @returns The newly created command details
 */
export default async function main(request: Request) {
    const params = (await request.json()) as CreateChannelParams;
    const { platform, title, bound_agent, botToken, enabled } = params;

    if (!platform) {
        return Response.json({ error: "Missing required field: platform" }, { status: 400 });
    }

    const sourceCommandKey = `im_channels|${platform}`;

    const dupParams: any = { sourceCommandKey };
    if (title) dupParams.title = title;

    const resp = await NativeAPI.localApi("enconvo/duplicate_provider", dupParams);
    const result = await resp.json() as any;

    if (!result?.command) {
        return Response.json({ error: `Failed to create channel from platform "${platform}"` }, { status: 500 });
    }

    const newCommandKey = result.command.commandKey as string;

    // Set preferences on the new channel if provided
    const prefsToSet: { keys: string[]; value: any }[] = [];
    if (bound_agent) prefsToSet.push({ keys: ["bound_agent"], value: bound_agent });
    if (botToken) prefsToSet.push({ keys: ["botToken"], value: botToken });
    if (enabled !== undefined) prefsToSet.push({ keys: ["enabled"], value: enabled });

    for (const pref of prefsToSet) {
        try {
            await PreferenceManageUtils.updatePreference({
                ...pref,
                preferenceKey: newCommandKey,
            });
        } catch (err: any) {
            console.error(`[IM] Failed to set ${pref.keys[0]} for ${newCommandKey}:`, err.message);
        }
    }

    return Response.json({
        success: true,
        command: result.command,
    });
}
