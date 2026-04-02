import { ChannelConnectionManager } from "../../connection_manager.ts";

interface FetchMessagesParams {
    /** The provider command key identifying which Discord connection to use @required */
    channel_provider: string;
    /** Channel ID to fetch messages from @required */
    channel_id: string;
    /** Number of messages to fetch (max 100) @default 50 */
    limit?: number;
}

/**
 * Pull recent message history from a Discord channel sorted oldest-first
 * @param {Request} request - Request object, body is {@link FetchMessagesParams}
 * @returns Array of messages with id, author, content, timestamp, and bot flag
 */
export default async function main(request: Request) {
    const params = (await request.json()) as FetchMessagesParams;
    const { channel_provider, channel_id, limit } = params;

    if (!channel_provider || !channel_id) {
        return Response.json({ error: "Missing required fields: channel_provider, channel_id" }, { status: 400 });
    }

    const connection = ChannelConnectionManager.shared().getLocalActive()
        .find(c => c.channelProvider === channel_provider);

    if (!connection) {
        return Response.json({ error: `No active connection for ${channel_provider}` }, { status: 404 });
    }

    try {
        const token = (connection.provider as any).botToken;
        const fetchLimit = Math.min(limit || 50, 100);
        const resp = await fetch(
            `https://discord.com/api/v10/channels/${channel_id}/messages?limit=${fetchLimit}`,
            {
                headers: { "Authorization": `Bot ${token}` },
            }
        );
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`Discord API ${resp.status}: ${errText}`);
        }

        const rawMessages = (await resp.json()) as any[];

        // Sort oldest-first
        const messages = rawMessages
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .map((m: any) => {
                const attCount = m.attachments?.length || 0;
                const attSuffix = attCount > 0 ? ` +${attCount}att` : "";
                return {
                    id: m.id,
                    author: m.author?.username || "Unknown",
                    content: `${m.content || ""}${attSuffix}`,
                    timestamp: m.timestamp,
                    is_bot: m.author?.bot || false,
                };
            });

        return Response.json({ success: true, messages });
    } catch (err: any) {
        return Response.json({ error: `Failed to fetch: ${err.message}` }, { status: 500 });
    }
}
