import { CommandManageUtils, NativeAPI } from "@enconvo/api";

/** Delete IM channel request params */
interface DeleteParams {
    /** The provider command key (e.g. "im_channels|discord") @required */
    channel_provider: string;
}

/**
 * Delete an IM channel provider command. Only user-created providers (create_for === "chat") can be deleted; built-in providers are protected.
 * @param {Request} request - Request object, body is {@link DeleteParams}
 * @returns Uninstall result from enconvo/uninstall_command, or an error object when the provider is built-in
 */
export default async function main(request: Request) {
    const params = (await request.json()) as DeleteParams;

    const rawCommand = CommandManageUtils.getRawCommandInfo(params.channel_provider)
    if (!rawCommand?.targetCommand) {
        return Response.json({
            error: 'the build-in chanel provider dose\'nt support deleted'
        })
    }

    return await NativeAPI.localApi('enconvo/uninstall_command', {
        commandKey: params.channel_provider
    })

}
