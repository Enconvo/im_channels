import { CommandManageUtils, TTSProvider } from "@enconvo/api";
import { ChannelConnectionManager } from "../../connection_manager.ts";
import { splitMessage, splitTextForTTS } from "../../utils.ts";
import * as fs from "fs";
import * as path from "path";

interface TelegramReplyParams {
    /** The channel provider key @required */
    channel_provider: string;
    /** Message text to send @required */
    text: string;
    /** Target chat ID. If omitted, sends to the default configured chat. */
    chat_id?: string;
    /** Message ID to reply to (creates native threading). Only use in group chats, not private chats. */
    reply_to?: string;
    /** Absolute file paths to attach. Images (.jpg/.png/.gif/.webp) as photos; others as documents. Max 50MB each. If a file exceeds 50MB, try compressing it first; if still over 50MB, split it into smaller segments before sending. */
    files?: string[];
}

/**
 * Send a message to a Telegram chat with optional file attachments and threading
 * @param {Request} request - Request object, body is {@link TelegramReplyParams}
 * @returns Success status with sent message IDs
 */
export default async function main(request: Request) {
    const params = (await request.json()) as TelegramReplyParams;
    const { channel_provider, text, reply_to, files } = params;
    let { chat_id } = params;

    if (!channel_provider || !text) {
        return Response.json({ error: "Missing required fields: channel_provider, text" }, { status: 400 });
    }

    const connection = ChannelConnectionManager.shared().getLocalActive()
        .find(c => c.channelProvider === channel_provider);

    if (!connection) {
        return Response.json({ error: `No active connection for ${channel_provider}` }, { status: 404 });
    }

    if (!chat_id) {
        chat_id = connection.provider.defaultChannelId ?? undefined;
    }

    if (!chat_id) {
        return Response.json({ error: "No chat_id provided and no default chat configured" }, { status: 400 });
    }

    try {
        const token = (connection.provider as any).botToken;
        const chunks = splitMessage(text, connection.provider.maxMessageLength);
        const sentIds: string[] = [];

        for (let i = 0; i < chunks.length; i++) {
            const body: any = {
                chat_id,
                text: chunks[i],
                parse_mode: "Markdown",
            };
            if (reply_to && i === 0) {
                body.reply_to_message_id = parseInt(reply_to);
            }
            const result = await telegramApi(token, "sendMessage", body);
            if (result?.result?.message_id) sentIds.push(result.result.message_id.toString());
        }

        //@ts-ignore
        const commandConfig = await CommandManageUtils.loadCommandConfig({ commandKey: connection.agentCommandKey, includes: ['auto_audio_play'] })

        // Generate and send TTS voice if auto_audio_play is enabled
        if (commandConfig?.['auto_audio_play'] === true) {
            try {
                const tts = await TTSProvider.fromEnv();
                const ttsChunks = splitTextForTTS(text);
                if (ttsChunks.length > 0 && (connection.provider as any).startTyping) {
                    (connection.provider as any).startTyping(chat_id);
                }
                for (const chunk of ttsChunks) {
                    const ttsItem = await tts.toFile({ text: chunk });
                    if (ttsItem.path) {
                        await connection.provider.sendMessage(chat_id, [{ type: "voice", url: ttsItem.path }]);
                    }
                }
            } catch (e: any) {
                console.error(`[Telegram] TTS generation failed:`, e.message);
            }
        }

        const fileErrors: Array<{ file: string; error: string }> = [];

        if (files && files.length > 0) {
            const imageExts = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

            for (const filePath of files) {
                try {
                    const fileBuffer = fs.readFileSync(filePath);
                    const fileName = path.basename(filePath);
                    const ext = path.extname(filePath).toLowerCase();
                    const isImage = imageExts.has(ext);

                    const formData = new FormData();
                    formData.append("chat_id", chat_id);
                    if (reply_to) formData.append("reply_to_message_id", reply_to);

                    const apiMethod = isImage ? "sendPhoto" : "sendDocument";
                    formData.append(isImage ? "photo" : "document", new Blob([fileBuffer]), fileName);

                    const resp = await fetch(`https://api.telegram.org/bot${token}/${apiMethod}`, {
                        method: "POST",
                        body: formData,
                    });
                    const result = (await resp.json()) as any;
                    if (result?.ok && result?.result?.message_id) {
                        sentIds.push(result.result.message_id.toString());
                    } else {
                        const errMsg = result?.description || `${apiMethod} failed with status ${resp.status}`;
                        fileErrors.push({ file: filePath, error: errMsg });
                    }
                } catch (e: any) {
                    fileErrors.push({ file: filePath, error: e.message });
                }
            }
        }

        // Stop typing indicator now that we've replied
        if ((connection.provider as any).stopTyping) {
            (connection.provider as any).stopTyping(chat_id);
        }

        const result: any = { success: true, message_ids: sentIds };
        if (fileErrors.length > 0) {
            result.file_errors = fileErrors;
        }
        return Response.json(result);
    } catch (err: any) {
        return Response.json({ error: `Failed to send: ${err.message}` }, { status: 500 });
    }
}

async function telegramApi(token: string, method: string, body: any): Promise<any> {
    const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Telegram API ${resp.status}: ${text}`);
    }
    return resp.json();
}
