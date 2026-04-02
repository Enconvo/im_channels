import { ChannelConnectionManager, ActiveConnection } from "../connection_manager.ts";

interface TypingIndicatorParams {
    /** The channel provider key (e.g. "im_channels|discord") @required */
    channel_provider: string;
    /** The channel ID @required */
    channel_id: string;
}

/**
 * Send typing indicator directly using a connection. Fire-and-forget, never throws.
 */
export function sendTyping(connection: ActiveConnection, channelId: string): void {
    const token = (connection.provider.getOptions() as any).botToken;
    if (!token) return;

    const providerName = connection.provider.name;
    if (providerName === "discord") {
        fetch(`https://discord.com/api/v10/channels/${channelId}/typing`, {
            method: "POST",
            headers: { Authorization: `Bot ${token}` },
        }).catch(() => { });
    } else if (providerName === "telegram") {
        fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: channelId, action: "typing" }),
        }).catch(() => { });
    }
}

/**
 * Send a typing indicator to a channel, best-effort with errors silently ignored
 * @param {Request} request - Request object, body is {@link TypingIndicatorParams}
 * @returns Success status
 */
export default async function main(request: Request) {
    const params = (await request.json()) as TypingIndicatorParams;
    const { channel_provider, channel_id } = params;

    if (!channel_provider || !channel_id) {
        return Response.json({ error: "Missing channel_provider or channel_id" }, { status: 400 });
    }

    const connection = ChannelConnectionManager.shared().getLocalActive()
        .find(c => c.channelProvider === channel_provider);

    if (!connection) {
        return Response.json({ success: true });
    }

    sendTyping(connection, channel_id);
    return Response.json({ success: true });
}
