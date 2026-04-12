import { ChannelConnectionManager } from "../../connection_manager.ts";
import * as fs from "fs";
import * as path from "path";

interface TelegramBotApiParams {
    /** The channel provider key (e.g. "im_channels|telegram") @required */
    channel_provider: string;
    /** The Telegram Bot API method name (e.g. "setMyName", "setMyProfilePhoto", "getMe"). See https://core.telegram.org/bots/api for all available methods. @required */
    method: string;
    /** The parameters to pass to the API method as a JSON object. Each method has its own parameters — refer to the Telegram Bot API docs. For file upload fields, pass a local file path (starting with "/") and it will be uploaded automatically via multipart/form-data. Note: Telegram Bot API limits file uploads to 50 MB max. If a file exceeds 50MB, try compressing it first; if still over 50MB, split it into smaller segments before sending. */
    params?: Record<string, any>;
}

/**
 * Call any Telegram Bot API method directly. The bot token is injected automatically —
 * you only need to specify the method name and its parameters.
 *
 * This is a generic passthrough to the Telegram Bot API. Use it for any method not
 * covered by the dedicated tools (reply, edit_message, react).
 *
 * File upload: any value that is a local file path (starting with "/") or a URL (http/https)
 * inside params — at any nesting depth — will be automatically downloaded and uploaded via
 * multipart/form-data using Telegram's `attach://` syntax. This works for top-level fields
 * and nested InputFile fields (e.g. InputProfilePhoto). Max file size: 50 MB (Telegram Bot API limit).
 *
 * You can also use `local_api enconvo/upload_file {"filePath": "/path/to/file"}` to upload
 * a file first and get a hosted URL.
 *
 * Common methods:
 * - `getMe` — get bot info (username, id, etc.)
 * - `setMyProfilePhoto` — set bot's own profile photo. Params: `{"photo": {"type": "static", "photo": "/path/to/image.png"}}` or `{"photo": {"type": "static", "photo": "https://..."}}`
 * - `deleteMyProfilePhoto` — remove bot's profile photo
 * - `setMyName` — change bot display name. Params: `{"name": "New Name"}`
 * - `setMyDescription` — change bot description. Params: `{"description": "text"}`
 * - `setMyShortDescription` — change bot short description shown in profile
 * - `setChatPhoto` — set group chat photo (bot must be admin). Params: `{"chat_id": "...", "photo": "/path/to/photo.png"}`
 * - `deleteChatPhoto` — remove group chat photo
 * - `getChat` — get chat details. Params: `{"chat_id": "..."}`
 * - `getChatMemberCount` — count members. Params: `{"chat_id": "..."}`
 * - `getChatMember` — get a specific member's info. Params: `{"chat_id": "...", "user_id": 123}`
 * - `banChatMember` / `unbanChatMember` — moderation
 * - `pinChatMessage` / `unpinChatMessage` — pin/unpin messages
 * - `setMyCommands` — set bot command menu. Params: `{"commands": [{"command": "start", "description": "Start the bot"}]}`
 * - `deleteMyCommands` — remove bot command menu
 * - `getMyCommands` — list current bot commands
 * - `setChatMenuButton` — set bot menu button
 * - `sendSticker` — send a sticker. Params: `{"chat_id": "...", "sticker": "/path/to/sticker.webp"}`
 * - `createNewStickerSet` / `addStickerToSet` — sticker set management
 * - `getCustomEmojiStickers` — get custom emoji stickers by IDs
 * - `setMessageReaction` — react to a message (also available as dedicated `react` tool)
 * - `forwardMessage` — forward a message. Params: `{"chat_id": "...", "from_chat_id": "...", "message_id": 123}`
 * - `copyMessage` — copy a message without "forwarded" label
 * - `exportChatInviteLink` — generate invite link for a group
 * - `setChatTitle` / `setChatDescription` — change group title/description
 * - `leaveChat` — make the bot leave a chat
 *
 * Full reference: https://core.telegram.org/bots/api
 *
 * @param {Request} request - Request object, body is {@link TelegramBotApiParams}
 * @returns Telegram API response result
 */
export default async function main(request: Request) {
    const body = (await request.json()) as TelegramBotApiParams;
    const { channel_provider, method, params } = body;

    if (!channel_provider || !method) {
        return Response.json({ error: "Missing required fields: channel_provider, method" }, { status: 400 });
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
        // Resolve file references in params: local paths and URLs → multipart attachments.
        // Telegram requires InputFile inside nested objects to use "attach://<key>" syntax.
        // E.g. setMyProfilePhoto params: {"photo": {"type": "static", "photo": "/path/to/img.png"}}
        //   → form field "file_0" = <file blob>
        //   → form field "photo" = '{"type":"static","photo":"attach://file_0"}'
        const fileAttachments: Array<{ key: string; blob: Blob; fileName: string }> = [];
        let attachCounter = 0;

        function isFilePath(v: any): boolean {
            return typeof v === "string" && v.startsWith("/");
        }
        function isFileUrl(v: any): boolean {
            return typeof v === "string" && (v.startsWith("http://") || v.startsWith("https://"));
        }

        // Recursively scan an object, replace file paths/URLs with "attach://file_N",
        // and queue the actual file data for multipart upload
        async function resolveFiles(obj: any): Promise<any> {
            if (typeof obj === "string") {
                if (isFilePath(obj)) {
                    const attachKey = `file_${attachCounter++}`;
                    const fileData = fs.readFileSync(obj);
                    fileAttachments.push({ key: attachKey, blob: new Blob([fileData]), fileName: path.basename(obj) });
                    return `attach://${attachKey}`;
                }
                if (isFileUrl(obj)) {
                    const dlResp = await fetch(obj);
                    if (!dlResp.ok) throw new Error(`Failed to download ${obj}: ${dlResp.status}`);
                    const dlBuffer = await dlResp.arrayBuffer();
                    const attachKey = `file_${attachCounter++}`;
                    const urlPath = new URL(obj).pathname;
                    fileAttachments.push({ key: attachKey, blob: new Blob([dlBuffer]), fileName: path.basename(urlPath) || "file" });
                    return `attach://${attachKey}`;
                }
                return obj;
            }
            if (Array.isArray(obj)) {
                return Promise.all(obj.map(item => resolveFiles(item)));
            }
            if (obj && typeof obj === "object") {
                const result: any = {};
                for (const [k, v] of Object.entries(obj)) {
                    result[k] = await resolveFiles(v);
                }
                return result;
            }
            return obj;
        }

        const resolvedParams = await resolveFiles(params || {});

        let response: globalThis.Response;
        if (fileAttachments.length > 0) {
            // Use multipart/form-data — attach files and serialize params
            const form = new FormData();
            // Append file blobs
            for (const att of fileAttachments) {
                form.append(att.key, att.blob, att.fileName);
            }
            // Append other params — objects as JSON strings, scalars as strings
            for (const [key, value] of Object.entries(resolvedParams)) {
                if (typeof value === "object") {
                    form.append(key, JSON.stringify(value));
                } else {
                    form.append(key, String(value));
                }
            }
            response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
                method: "POST",
                body: form,
            });
        } else {
            response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(resolvedParams),
            });
        }

        const data = await response.json() as any;

        if (!data.ok) {
            return Response.json({
                error: `Telegram API error: ${data.description || "Unknown error"}`,
                error_code: data.error_code,
            }, { status: response.status });
        }

        return Response.json({ success: true, result: data.result });
    } catch (err: any) {
        return Response.json({ error: `Request failed: ${err.message}` }, { status: 500 });
    }
}
