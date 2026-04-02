import { ChannelConnectionManager } from "../../connection_manager.ts";
import * as fs from "fs";
import * as path from "path";

interface DiscordBotApiParams {
    /** The channel provider key (e.g. "im_channels|discord") @required */
    channel_provider: string;
    /** HTTP method (GET, POST, PUT, PATCH, DELETE) @required */
    http_method: string;
    /** The Discord API path (e.g. "/users/@me", "/channels/123/messages"). Do NOT include the base URL. @required */
    path: string;
    /** The JSON body to send (for POST/PUT/PATCH requests). For the `avatar` field in PATCH /users/@me, pass a local file path (starting with "/") — it will be read and converted to a data URI automatically. */
    body?: Record<string, any>;
}

/**
 * Call any Discord REST API endpoint directly. The bot token and base URL are injected
 * automatically — you only need to specify the HTTP method, path, and optional body.
 *
 * This is a generic passthrough to the Discord API v10. Use it for any endpoint not
 * covered by the dedicated tools (reply, edit_message, react, fetch_messages, download_attachment).
 *
 * Image fields (`avatar`, `icon`, `image`, `splash`, `banner`) accept a local file path
 * (starting with "/") — it will be auto-converted to a base64 data URI as Discord requires.
 * You can also use `local_api enconvo/upload_file {"filePath": "/path/to/file"}` to get a hosted URL.
 *
 * Common endpoints:
 *
 * Bot profile:
 * - `GET /users/@me` — get bot user info (username, id, avatar hash, etc.)
 * - `PATCH /users/@me` — update bot profile. Body: `{"username": "New Name", "avatar": "/path/to/image.png"}`
 *
 * Server (Guild) info:
 * - `GET /guilds/{guild_id}` — get server info (name, icon, owner, member count)
 * - `GET /guilds/{guild_id}/channels` — list all channels in a server
 * - `GET /guilds/{guild_id}/members?limit=100` — list server members
 * - `GET /guilds/{guild_id}/roles` — list server roles
 * - `PATCH /guilds/{guild_id}` — modify server (name, icon, etc.)
 *
 * Channel management:
 * - `GET /channels/{channel_id}` — get channel info (name, topic, type)
 * - `PATCH /channels/{channel_id}` — modify channel (name, topic, permissions)
 * - `DELETE /channels/{channel_id}` — delete a channel
 * - `POST /guilds/{guild_id}/channels` — create a new channel. Body: `{"name": "new-channel", "type": 0}`
 *
 * Messages:
 * - `POST /channels/{channel_id}/messages` — send a message. Body: `{"content": "Hello!"}`
 * - `GET /channels/{channel_id}/messages?limit=50` — get recent messages
 * - `PATCH /channels/{channel_id}/messages/{message_id}` — edit a message
 * - `DELETE /channels/{channel_id}/messages/{message_id}` — delete a message
 * - `PUT /channels/{channel_id}/pins/{message_id}` — pin a message
 * - `DELETE /channels/{channel_id}/pins/{message_id}` — unpin a message
 *
 * Member management:
 * - `GET /guilds/{guild_id}/members/{user_id}` — get a member's info
 * - `PATCH /guilds/{guild_id}/members/{user_id}` — modify member (nickname, roles). Body: `{"nick": "New Nick"}`
 * - `PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}` — add role to member
 * - `DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}` — remove role from member
 * - `PUT /guilds/{guild_id}/bans/{user_id}` — ban a member
 * - `DELETE /guilds/{guild_id}/bans/{user_id}` — unban a member
 * - `DELETE /guilds/{guild_id}/members/{user_id}` — kick a member
 *
 * Reactions:
 * - `PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me` — add reaction
 * - `DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me` — remove reaction
 *
 * Invites:
 * - `POST /channels/{channel_id}/invites` — create invite. Body: `{"max_age": 86400, "max_uses": 10}`
 * - `GET /guilds/{guild_id}/invites` — list server invites
 *
 * Full reference: https://discord.com/developers/docs/reference
 *
 * @param {Request} request - Request object, body is {@link DiscordBotApiParams}
 * @returns Discord API response result
 */
export default async function main(request: Request) {
    const params = (await request.json()) as DiscordBotApiParams;
    const { channel_provider, http_method, path: apiPath, body } = params;

    if (!channel_provider || !http_method || !apiPath) {
        return Response.json({ error: "Missing required fields: channel_provider, http_method, path" }, { status: 400 });
    }

    const connection = ChannelConnectionManager.shared().getLocalActive()
        .find(c => c.channelProvider === channel_provider);

    if (!connection) {
        return Response.json({ error: `No active connection for ${channel_provider}` }, { status: 404 });
    }

    const botToken = (connection.provider as any).botToken;
    if (!botToken) {
        return Response.json({ error: "Bot token not available" }, { status: 500 });
    }

    try {
        const normalizedPath = apiPath.startsWith("/") ? apiPath : `/${apiPath}`;
        const method = http_method.toUpperCase();

        // Auto-convert local file paths to data URIs for image fields (e.g. avatar, icon)
        const processedBody = body ? { ...body } : undefined;
        if (processedBody) {
            for (const key of ["avatar", "icon", "image", "splash", "banner"]) {
                const val = processedBody[key];
                if (typeof val === "string" && val.startsWith("/")) {
                    processedBody[key] = localFileToDataUri(val);
                }
            }
        }

        const options: RequestInit = {
            method,
            headers: {
                "Authorization": `Bot ${botToken}`,
                "Content-Type": "application/json",
            },
        };

        if (processedBody && method !== "GET" && method !== "HEAD") {
            options.body = JSON.stringify(processedBody);
        }

        const response = await fetch(`https://discord.com/api/v10${normalizedPath}`, options);

        if (response.status === 204) {
            return Response.json({ success: true });
        }

        const data = await response.json() as any;

        if (!response.ok) {
            return Response.json({
                error: `Discord API ${response.status}: ${data.message || JSON.stringify(data)}`,
                code: data.code,
            }, { status: response.status });
        }

        return Response.json({ success: true, result: data });
    } catch (err: any) {
        return Response.json({ error: `Request failed: ${err.message}` }, { status: 500 });
    }
}

/** Read a local file and convert to data:image/...;base64,... URI */
function localFileToDataUri(filePath: string): string {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
    };
    const mime = mimeMap[ext] || "image/png";
    return `data:${mime};base64,${buffer.toString("base64")}`;
}
