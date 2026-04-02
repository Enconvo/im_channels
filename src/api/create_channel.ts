import { NativeAPI, PreferenceManageUtils } from "@enconvo/api";

interface CreateChannelParams {
    /** The platform name (e.g. "discord", "telegram") @required */
    platform: string;
    /** Custom title for the new channel (e.g. "Sensei English Bot"). If omitted, auto-generates "Discord 2", "Telegram 3", etc. */
    title?: string;
    /** The agent command key to bind to this channel (e.g. "chat_with_ai|chat_command"). If provided, the channel's bound_agent preference will be set automatically. */
    bound_agent?: string;
}

/**
 * Create a new channel by duplicating the base provider command for a platform
 * @param {Request} request - Request object, body is {@link CreateChannelParams}
 * @returns The newly created command details
 */
export default async function main(request: Request) {
    const params = (await request.json()) as CreateChannelParams;
    const { platform, title, bound_agent } = params;

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

    // Set bound_agent preference if provided
    if (bound_agent) {
        try {
            await PreferenceManageUtils.updatePreference({
                keys: ["bound_agent"],
                value: bound_agent,
                preferenceKey: newCommandKey,
            });
        } catch (err: any) {
            console.error(`[IM] Failed to set bound_agent for ${newCommandKey}:`, err.message);
        }
    }

    return Response.json({
        success: true,
        command: result.command,
    });
}
