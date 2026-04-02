import { ChannelConnectionManager } from "../../connection_manager.ts";

interface DiscordReactParams {
    /** The provider command key identifying which Discord connection to use @required */
    channel_provider: string;
    /** Channel ID where the message is @required */
    channel_id: string;
    /** Message ID to react to @required */
    message_id: string;
    /** Emoji to react with. Unicode emoji (e.g. "👍") or custom emoji in <:name:id> form @required */
    emoji: string;
}

/**
 * Add an emoji reaction to a Discord message by ID
 * @param {Request} request - Request object, body is {@link DiscordReactParams}
 * @returns Success status
 */
export default async function main(request: Request) {
    const params = (await request.json()) as DiscordReactParams;
    const { channel_provider, channel_id, message_id, emoji } = params;

    if (!channel_provider || !channel_id || !message_id || !emoji) {
        return Response.json({ error: "Missing required fields: channel_provider, channel_id, message_id, emoji" }, { status: 400 });
    }

    const connection = ChannelConnectionManager.shared().getLocalActive()
        .find(c => c.channelProvider === channel_provider);

    if (!connection) {
        return Response.json({ error: `No active connection for ${channel_provider}` }, { status: 404 });
    }

    try {
        const token = (connection.provider as any).botToken;
        const encoded = encodeURIComponent(emoji);
        const resp = await fetch(
            `https://discord.com/api/v10/channels/${channel_id}/messages/${message_id}/reactions/${encoded}/@me`,
            {
                method: "PUT",
                headers: { "Authorization": `Bot ${token}` },
            }
        );
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Discord API ${resp.status}: ${text}`);
        }
        return Response.json({ success: true });
    } catch (err: any) {
        return Response.json({ error: `Failed to react: ${err.message}` }, { status: 500 });
    }
}
