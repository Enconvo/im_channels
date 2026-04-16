import { CommandManageUtils, PreferenceManageUtils } from "@enconvo/api";

/** Approve pairing request params */
interface ApproveParams {
    /** Channel name from all_channels list (e.g. "telegram", "discord") */
    channel: string
    /** The 8-character pairing code */
    code: string
}

/**
 * Approve a pending pairing request to grant a user access to the bot
 * @param {Request} request - Request object, body is {@link ApproveParams}
 * @returns Approved user info including userId and username
 */
export default async function POST(request: Request) {
    const params = (await request.json()) as ApproveParams;
    const { channel, code } = params;

    if (!channel || !code) {
        return Response.json({ error: "Missing channel and code" }, { status: 400 });
    }

    const commandKey = `im_channels|${channel}`;

    const config = await CommandManageUtils.loadCommandConfig({
        commandKey,
        includes: ["access"],
    });

    const access = config?.access;
    if (!access || !Array.isArray(access.pending)) {
        return Response.json({ error: "No pending pairings found" }, { status: 404 });
    }

    const entry = access.pending.find((p: any) => p.code === code.toUpperCase());
    if (!entry) {
        return Response.json({ error: `Pairing code ${code} not found` }, { status: 404 });
    }

    access.allowList = [
        ...(access.allowList || []),
        {
            userId: entry.userId,
            username: entry.username,
            firstName: entry.firstName,
            chatId: entry.chatId,
            approvedAt: Date.now(),
        },
    ];
    access.pending = access.pending.filter((p: any) => p.code !== code.toUpperCase());

    await PreferenceManageUtils.updatePreference({
        keys: ["access"],
        value: access,
        preferenceKey: commandKey,
    });

    return Response.json({
        success: true,
        approved: { userId: entry.userId, username: entry.username },
    });
}
