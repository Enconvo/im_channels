import { CommandManageUtils } from "@enconvo/api";

/** Get access control config params */
interface AccessParams {
    /** The provider command key (e.g. "im_channels|telegram") @required */
    channel_provider: string
}

/**
 * Get access control configuration for a channel
 * @param {Request} request - Request object, body is {@link AccessParams}
 * @returns Access control config including policy, allowList and pending pairings
 */
export default async function POST(request: Request) {
    const params = (await request.json()) as AccessParams;
    const { channel_provider } = params;

    if (!channel_provider) {
        return Response.json({ error: "Missing channel_provider" }, { status: 400 });
    }

    const config = await CommandManageUtils.loadCommandConfig({
        commandKey: channel_provider,
        includes: ["access"],
    });

    const access = config?.access

    return Response.json({ success: true, ...access });
}
