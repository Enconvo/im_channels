import { CommandManageUtils, PreferenceManageUtils, ServiceProvider, IMChannelProvider } from "@enconvo/api";

/** Deny pairing request params */
interface DenyParams {
    /** Channel name from all_channels list (e.g. "telegram", "discord") */
    channel: string
    /** The 8-character pairing code */
    code: string
}

/**
 * Deny a pending pairing request — removes it from the pending list
 * @param {Request} request - Request object, body is {@link DenyParams}
 * @returns Denied user info including userId and username
 */
export default async function POST(request: Request) {
    const params = (await request.json()) as DenyParams;
    const { channel, code } = params;

    if (!channel || !code) {
        return Response.json({ error: "Missing channel and code" }, { status: 400 });
    }

    const commandKey = `im_channels|${channel}`;

    const config = await CommandManageUtils.loadCommandConfig({
        commandKey,
    }) as Record<string, any> | null;

    const access = config?.access;
    if (!access || !Array.isArray(access.pending)) {
        return Response.json({ error: "No pending pairings found" }, { status: 404 });
    }

    const entry = access.pending.find((p: any) => p.code === code.toUpperCase());
    if (!entry) {
        return Response.json({ error: `Pairing code ${code} not found` }, { status: 404 });
    }

    access.pending = access.pending.filter((p: any) => p.code !== code.toUpperCase());

    await PreferenceManageUtils.updatePreference({
        keys: ["access"],
        value: access,
        preferenceKey: commandKey,
    });

    if (config && entry.chatId) {
        try {
            config.commandKey = commandKey;
            const rawCommand = CommandManageUtils.getRawCommandInfo(commandKey);
            if (rawCommand?.targetCommand) {
                config.targetCommand = rawCommand.targetCommand;
            }
            const provider: IMChannelProvider = ServiceProvider.load(config);
            if (provider.isReady()) {
                await provider.sendMessage(entry.chatId, [
                    { type: "text", text: "Your pairing request was denied." },
                ]);
            }
        } catch (err: any) {
            console.error(`[IM] Failed to notify denied user on ${channel}:`, err.message);
        }
    }

    return Response.json({
        success: true,
        denied: { userId: entry.userId, username: entry.username },
    });
}
