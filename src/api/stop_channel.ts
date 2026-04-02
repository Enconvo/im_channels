import { ChannelConnectionManager } from "../connection_manager.ts";

interface StopChannelParams {
    /** The provider command key (e.g. "im_channels|discord") @required */
    channel_provider: string;
}

/**
 * Stop a running channel listener
 * @param {Request} request - Request object, body is {@link StopChannelParams}
 * @returns Success status with the stopped channel provider key
 */
export default async function main(request: Request) {
    console.log("[IM stop_channel] called");
    let params: StopChannelParams;
    try {
        params = (await request.json()) as StopChannelParams;
    } catch (e: any) {
        console.error("[IM stop_channel] Failed to parse request body:", e.message);
        return Response.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { channel_provider } = params;
    console.log("[IM stop_channel] channel_provider:", channel_provider);

    if (!channel_provider) {
        return Response.json(
            { error: "Missing required field: channel_provider" },
            { status: 400 },
        );
    }

    try {
        await ChannelConnectionManager.shared().stop(channel_provider);
        console.log("[IM stop_channel] stopped:", channel_provider);
        return Response.json({
            success: true,
            channelProvider: channel_provider,
        });
    } catch (err: any) {
        console.error("[IM stop_channel] error:", err.message);
        return Response.json({ error: err.message }, { status: 500 });
    }
}
