import { CommandManageUtils } from "@enconvo/api";

interface CheckConnectionParams {
    /** The provider command key @required */
    channel_provider: string;
}

/**
 * Check if a channel's credentials are valid by calling the platform API
 * @param {Request} request - Request object, body is {@link CheckConnectionParams}
 * @returns Validation result with bot info and optional channel access status
 */
export default async function main(request: Request) {
    console.log("[IM check_connection] called");
    let params: CheckConnectionParams;
    try {
        params = (await request.json()) as CheckConnectionParams;
    } catch (e: any) {
        console.error("[IM check_connection] Failed to parse request body:", e.message);
        return Response.json({ valid: false, error: "Invalid request body" });
    }

    const { channel_provider } = params;
    console.log("[IM check_connection] channel_provider:", channel_provider);

    if (!channel_provider) {
        return Response.json({ valid: false, error: "Missing channel_provider" });
    }

    let config: Record<string, any> = {};
    try {
        const saved = await CommandManageUtils.loadCommandConfig({
            commandKey: channel_provider,
            decrypt: true,
        });
        if (saved) config = saved as Record<string, any>;
        console.log("[IM check_connection] loaded config keys:", Object.keys(config));
    } catch (e: any) {
        console.error("[IM check_connection] Failed to load config:", e.message);
        return Response.json({ valid: false, error: "Could not load provider config" });
    }

    // Determine channel type from command key
    const parts = channel_provider.split("|");
    let cmdName = parts[parts.length - 1];

    const rawCommand = CommandManageUtils.getRawCommandInfo(channel_provider)
    if (rawCommand?.targetCommand) {
        const parts = rawCommand?.targetCommand.split("|");
        cmdName = parts[parts.length - 1];
    }

    let channelType = "";
    if (cmdName.startsWith("discord")) channelType = "discord";
    else if (cmdName.startsWith("telegram")) channelType = "telegram";
    console.log("[IM check_connection] channelType:", channelType, "cmdName:", cmdName);

    try {
        let result: any;
        switch (channelType) {
            case "discord":
                result = await checkDiscord(config);
                break;
            case "telegram":
                result = await checkTelegram(config);
                break;
            default:
                result = { valid: false, error: `Unknown channel type: ${cmdName}` };
        }
        console.log("[IM check_connection] result:", JSON.stringify(result));
        return Response.json(result);
    } catch (err: any) {
        console.error("[IM check_connection] error:", err.message);
        return Response.json({ valid: false, error: err.message });
    }
}

async function checkDiscord(config: Record<string, any>) {
    const token = config.botToken;
    if (!token) return { valid: false, error: "Bot Token is not configured" };

    console.log("[IM check_connection] Discord: verifying bot token...");
    const resp = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bot ${token}` },
    });
    if (!resp.ok) return { valid: false, error: `Invalid Bot Token (${resp.status})` };
    const bot = (await resp.json()) as any;
    console.log("[IM check_connection] Discord: bot verified:", bot.username);

    const result: any = {
        valid: true,
        bot_name: bot.username,
        bot_id: bot.id,
    };

    // If channel_id is set, verify access
    const channelId = config.channel_id;
    if (channelId) {
        console.log("[IM check_connection] Discord: checking channel_id:", channelId);
        const chResp = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
            headers: { Authorization: `Bot ${token}` },
        });
        if (!chResp.ok) {
            result.channel_valid = false;
            result.channel_error = `Cannot access channel ${channelId} (${chResp.status}). Make sure this is a Channel ID, not a Server/Guild ID.`;
        } else {
            const ch = (await chResp.json()) as any;
            result.channel_valid = true;
            result.channel_name = ch.name;
            console.log("[IM check_connection] Discord: channel verified:", ch.name);
        }
    }

    return result;
}

async function checkTelegram(config: Record<string, any>) {
    const token = config.botToken;
    if (!token) return { valid: false, error: "Bot Token is not configured" };

    console.log("[IM check_connection] Telegram: verifying bot token...");
    const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await resp.json()) as any;
    if (!data.ok) return { valid: false, error: "Invalid Bot Token" };

    console.log("[IM check_connection] Telegram: verified bot:", data.result.username);
    return { valid: true, bot_name: data.result.username, bot_id: data.result.id };
}

