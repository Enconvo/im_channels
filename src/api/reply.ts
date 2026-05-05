import { NativeAPI } from "@enconvo/api";

interface ReplyParams {
    /** The channel provider command key, e.g. "im_channels|telegram" @required */
    channel_provider: string;
    /** Message text to send @required */
    text: string;
    /** Target chat ID (Telegram chat_id or Discord channel ID) */
    chat_id?: string;
    /** Target user ID for sending a Discord DM (ignored on Telegram) */
    user_id?: string;
    /** Message ID to reply to (creates threaded reply on supported channels) */
    reply_to?: string;
    /** Absolute file paths or URLs to attach */
    files?: string[];
}

/**
 * Channel-agnostic reply: dispatches to the channel-specific reply API based
 * on the `channel_provider` command key (e.g. `im_channels|telegram` →
 * `im_channels/telegram_actions/reply`).
 *
 * @param {Request} request - Request object, body is {@link ReplyParams}
 * @returns Whatever the underlying channel-specific reply returns
 */
export default async function main(request: Request) {
    const params = (await request.json()) as ReplyParams;
    const { channel_provider, text } = params;

    if (!channel_provider || !text) {
        return Response.json(
            { error: "Missing required fields: channel_provider, text" },
            { status: 400 },
        );
    }

    const [, channelName] = channel_provider.split("|");
    if (!channelName) {
        return Response.json(
            { error: `Invalid channel_provider: ${channel_provider}` },
            { status: 400 },
        );
    }

    const target = `im_channels/${channelName}_actions/reply`;
    const resp = await NativeAPI.api(target, params as any);
    return resp;
}
