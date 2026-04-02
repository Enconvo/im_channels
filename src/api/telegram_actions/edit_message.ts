import { ChannelConnectionManager } from "../../connection_manager.ts";

interface TelegramEditParams {
    /** The provider command key identifying which Telegram connection to use @required */
    channel_provider: string;
    /** Chat ID where the message is @required */
    chat_id: string;
    /** Message ID to edit (must be bot's own message) @required */
    message_id: string;
    /** New text content @required */
    text: string;
}

/**
 * Edit a message the bot previously sent in Telegram
 * @param {Request} request - Request object, body is {@link TelegramEditParams}
 * @returns Success status with the edited message ID
 */
export default async function main(request: Request) {
    const params = (await request.json()) as TelegramEditParams;
    const { channel_provider, chat_id, message_id, text } = params;

    if (!channel_provider || !chat_id || !message_id || !text) {
        return Response.json({ error: "Missing required fields: channel_provider, chat_id, message_id, text" }, { status: 400 });
    }

    const connection = ChannelConnectionManager.shared().getLocalActive()
        .find(c => c.channelProvider === channel_provider);

    if (!connection) {
        return Response.json({ error: `No active connection for ${channel_provider}` }, { status: 404 });
    }

    try {
        const token = (connection.provider as any).botToken;
        const resp = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id,
                message_id: parseInt(message_id),
                text,
                parse_mode: "Markdown",
            }),
        });
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`Telegram API ${resp.status}: ${errText}`);
        }
        const result = (await resp.json()) as any;
        return Response.json({ success: true, message_id: result.result?.message_id?.toString() });
    } catch (err: any) {
        return Response.json({ error: `Failed to edit: ${err.message}` }, { status: 500 });
    }
}
