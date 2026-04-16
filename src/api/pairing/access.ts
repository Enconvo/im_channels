import { CommandManageUtils } from "@enconvo/api";

/** Get access control config params */
interface AccessParams {
    /** Channel name from all_channels list (e.g. "telegram", "discord") @required */
    channel: string
}

/**
 * Get access control configuration for a channel
 * @param {Request} request - Request object, body is {@link AccessParams}
 * @returns Access control config including policy, allowList and pending pairings
 */
export default async function POST(request: Request) {
    const params = (await request.json()) as AccessParams;
    const { channel } = params;

    if (!channel) {
        return Response.json({ error: "Missing channel" }, { status: 400 });
    }

    const commandKey = `im_channels|${channel}`;

    const config = await CommandManageUtils.loadCommandConfig({
        commandKey,
        includes: ["access"],
    });

    const access = config?.access

    return Response.json({ success: true, ...access });
}
