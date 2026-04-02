import { ChannelConnectionManager } from "../../connection_manager.ts";

interface TelegramReactParams {
    /** The provider command key identifying which Telegram connection to use @required */
    channel_provider: string;
    /** Chat ID where the message is @required */
    chat_id: string;
    /** Message ID to react to @required */
    message_id: string;
    /** Emoji to react with. Only Telegram's fixed whitelist is accepted @required */
    emoji: string;
}

/**
 * Add an emoji reaction to a Telegram message by ID
 * @param {Request} request - Request object, body is {@link TelegramReactParams}
 * @returns Success status
 */
export default async function main(request: Request) {
    const params = (await request.json()) as TelegramReactParams;
    const { channel_provider, chat_id, message_id, emoji } = params;

    if (!channel_provider || !chat_id || !message_id || !emoji) {
        return Response.json({ error: "Missing required fields: channel_provider, chat_id, message_id, emoji" }, { status: 400 });
    }

    const connection = ChannelConnectionManager.shared().getLocalActive()
        .find(c => c.channelProvider === channel_provider);

    if (!connection) {
        return Response.json({ error: `No active connection for ${channel_provider}` }, { status: 404 });
    }

    try {
        const token = (connection.provider as any).botToken;
        const resp = await fetch(`https://api.telegram.org/bot${token}/setMessageReaction`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id,
                message_id: parseInt(message_id),
                reaction: [{ type: "emoji", emoji }],
            }),
        });
        if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Telegram API ${resp.status}: ${text}`);
        }
        return Response.json({ success: true });
    } catch (err: any) {
        return Response.json({ error: `Failed to react: ${err.message}` }, { status: 500 });
    }
}
