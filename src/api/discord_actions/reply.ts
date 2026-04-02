import { ChannelConnectionManager } from "../../connection_manager.ts";
import { splitMessage } from "../../utils.ts";
import * as fs from "fs";
import * as path from "path";

interface DiscordReplyParams {
    /** The channel provider key @required */
    channel_provider: string;
    /** Message text to send @required */
    text: string;
    /** Target channel ID. If omitted, sends to the default configured channel. */
    chat_id?: string;
    /** Target user ID (snowflake) for sending a DM. Only use when explicitly asked to DM a user. */
    user_id?: string;
    /** Message ID to reply to (creates threaded reply). Only use in channel messages, not DMs. */
    reply_to?: string;
    /** File paths (absolute local paths) or URLs to attach. Max 10, 25MB each for local files. URLs are sent as embeds. */
    files?: string[];
}

/**
 * Send a message to a Discord channel or DM with optional file attachments and threading
 * @param {Request} request - Request object, body is {@link DiscordReplyParams}
 * @returns Success status with sent message IDs and target channel ID
 */
export default async function main(request: Request) {
    const params = (await request.json()) as DiscordReplyParams;
    const { channel_provider, text, chat_id, user_id, reply_to, files } = params;

    if (!channel_provider || !text) {
        return Response.json({ error: "Missing required fields: channel_provider, text" }, { status: 400 });
    }

    const connection = ChannelConnectionManager.shared().getLocalActive()
        .find(c => c.channelProvider === channel_provider);

    if (!connection) {
        return Response.json({ error: `No active connection for ${channel_provider}` }, { status: 404 });
    }

    try {
        // Resolve target channel: explicit chat_id > DM via user_id > default channel
        let targetChannelId = chat_id;

        if (!targetChannelId && user_id) {
            const dmChannel = await discordRest(connection, "POST", "/users/@me/channels", { recipient_id: user_id });
            targetChannelId = dmChannel.id;
        }

        if (!targetChannelId) {
            targetChannelId = connection.provider.defaultChannelId;
        }

        if (!targetChannelId) {
            return Response.json({ error: "No chat_id, user_id, or default channel configured" }, { status: 400 });
        }

        // Separate files into local paths and URLs
        const localFiles: string[] = [];
        const urlFiles: string[] = [];
        if (files && files.length > 0) {
            for (const f of files) {
                if (f.startsWith("http://") || f.startsWith("https://")) {
                    urlFiles.push(f);
                } else {
                    localFiles.push(f);
                }
            }
        }

        const chunks = splitMessage(text, connection.provider.maxMessageLength);
        const sentIds: string[] = [];

        // Send text chunks
        for (let i = 0; i < chunks.length; i++) {
            const body: any = { content: chunks[i] };
            if (reply_to && i === 0) {
                body.message_reference = { message_id: reply_to };
            }
            // Attach image URL embeds to the last text chunk
            if (i === chunks.length - 1 && urlFiles.length > 0) {
                body.embeds = urlFiles.map(url => ({ image: { url } }));
            }
            const result = await discordRest(connection, "POST", `/channels/${targetChannelId}/messages`, body);
            if (result?.id) sentIds.push(result.id);
        }

        // Send local files as separate messages
        if (localFiles.length > 0) {
            for (const filePath of localFiles.slice(0, 10)) {
                try {
                    const fileBuffer = fs.readFileSync(filePath);
                    const fileName = path.basename(filePath);

                    const formData = new FormData();
                    formData.append("file", new Blob([fileBuffer]), fileName);
                    if (reply_to) {
                        formData.append("payload_json", JSON.stringify({
                            message_reference: { message_id: reply_to }
                        }));
                    }

                    const resp = await fetch(`https://discord.com/api/v10/channels/${targetChannelId}/messages`, {
                        method: "POST",
                        headers: { "Authorization": `Bot ${(connection.provider as any).botToken}` },
                        body: formData,
                    });
                    if (resp.ok) {
                        const result = await resp.json() as any;
                        if (result?.id) sentIds.push(result.id);
                    }
                } catch (e: any) {
                    console.error(`[Discord] Failed to send file ${filePath}:`, e.message);
                }
            }
        }

        // Stop typing indicator now that we've replied
        if ((connection.provider as any).stopTyping) {
            (connection.provider as any).stopTyping(targetChannelId);
        }

        return Response.json({ success: true, message_ids: sentIds, channel_id: targetChannelId });
    } catch (err: any) {
        return Response.json({ error: `Failed to send: ${err.message}` }, { status: 500 });
    }
}

async function discordRest(connection: any, method: string, path: string, body?: any): Promise<any> {
    const token = (connection.provider as any).botToken;
    const options: RequestInit = {
        method,
        headers: {
            "Authorization": `Bot ${token}`,
            "Content-Type": "application/json",
        },
    };
    if (body && method !== "GET") options.body = JSON.stringify(body);

    const response = await fetch(`https://discord.com/api/v10${path}`, options);
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Discord API ${response.status}: ${text}`);
    }
    if (response.status === 204) return null;
    return response.json();
}
