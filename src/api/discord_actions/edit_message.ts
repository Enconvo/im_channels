import { ChannelConnectionManager } from "../../connection_manager.ts";

interface DiscordEditParams {
    /** The provider command key identifying which Discord connection to use @required */
    channel_provider: string;
    /** Channel ID where the message is @required */
    channel_id: string;
    /** Message ID to edit (must be bot's own message) @required */
    message_id: string;
    /** New text content @required */
    text: string;
}

/**
 * Edit a message the bot previously sent in Discord
 * @param {Request} request - Request object, body is {@link DiscordEditParams}
 * @returns Success status with the edited message ID
 */
export default async function main(request: Request) {
    const params = (await request.json()) as DiscordEditParams;
    const { channel_provider, channel_id, message_id, text } = params;

    if (!channel_provider || !channel_id || !message_id || !text) {
        return Response.json({ error: "Missing required fields: channel_provider, channel_id, message_id, text" }, { status: 400 });
    }

    const connection = ChannelConnectionManager.shared().getLocalActive()
        .find(c => c.channelProvider === channel_provider);

    if (!connection) {
        return Response.json({ error: `No active connection for ${channel_provider}` }, { status: 404 });
    }

    try {
        const token = (connection.provider as any).botToken;
        const resp = await fetch(
            `https://discord.com/api/v10/channels/${channel_id}/messages/${message_id}`,
            {
                method: "PATCH",
                headers: {
                    "Authorization": `Bot ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ content: text }),
            }
        );
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`Discord API ${resp.status}: ${errText}`);
        }
        const result = await resp.json() as any;
        return Response.json({ success: true, message_id: result.id });
    } catch (err: any) {
        return Response.json({ error: `Failed to edit: ${err.message}` }, { status: 500 });
    }
}
