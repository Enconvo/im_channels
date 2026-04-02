import { ChannelConnectionManager } from "../../connection_manager.ts";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface DownloadAttachmentParams {
    /** The provider command key identifying which Discord connection to use @required */
    channel_provider: string;
    /** Channel ID where the message is @required */
    channel_id: string;
    /** Message ID to download attachments from @required */
    message_id: string;
}

const INBOX_DIR = path.join(os.homedir(), ".claude", "channels", "discord", "inbox");

/**
 * Download all attachments from a Discord message to local inbox directory
 * @param {Request} request - Request object, body is {@link DownloadAttachmentParams}
 * @returns Downloaded file paths with filename, size, and content type
 */
export default async function main(request: Request) {
    const params = (await request.json()) as DownloadAttachmentParams;
    const { channel_provider, channel_id, message_id } = params;

    if (!channel_provider || !channel_id || !message_id) {
        return Response.json({ error: "Missing required fields: channel_provider, channel_id, message_id" }, { status: 400 });
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
            { headers: { "Authorization": `Bot ${token}` } }
        );
        if (!resp.ok) {
            const errText = await resp.text();
            throw new Error(`Discord API ${resp.status}: ${errText}`);
        }

        const msg = (await resp.json()) as any;
        const attachments = msg.attachments || [];

        if (attachments.length === 0) {
            return Response.json({ success: true, files: [], message: "No attachments on this message" });
        }

        if (!fs.existsSync(INBOX_DIR)) {
            fs.mkdirSync(INBOX_DIR, { recursive: true });
        }

        const downloaded: Array<{ path: string; filename: string; size: number; content_type: string }> = [];

        for (const att of attachments) {
            const fileResp = await fetch(att.url);
            if (!fileResp.ok) continue;

            const buffer = Buffer.from(await fileResp.arrayBuffer());
            const filePath = path.join(INBOX_DIR, `${message_id}_${att.filename}`);
            fs.writeFileSync(filePath, buffer);

            downloaded.push({
                path: filePath,
                filename: att.filename,
                size: att.size,
                content_type: att.content_type || "application/octet-stream",
            });
        }

        return Response.json({ success: true, files: downloaded });
    } catch (err: any) {
        return Response.json({ error: `Failed to download: ${err.message}` }, { status: 500 });
    }
}
