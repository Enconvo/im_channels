import { NativeAPI } from "@enconvo/api";

/** Channel info returned by the all_channels endpoint */
interface ChannelInfo {
    /** Short channel name, used as identifier in other APIs (e.g. "telegram", "discord") */
    name: string
    /** Full command key (e.g. "im_channels|telegram") */
    commandKey: string
    /** Human-readable display title */
    title: string
    /** Channel description */
    description: string
    /** Icon filename */
    icon: string
}

/**
 * List all available IM channel providers
 * @param {Request} _request - Request object (no body required)
 * @returns Array of {@link ChannelInfo}
 */
export default async function main(_request: Request) {
    const resp: Response = await NativeAPI.api('search/providers', {
        category: 'im_channel'
    })

    const json: ChannelInfo[] = await resp.json()

    return Response.json(json.map((item) => ({
        name: item.name,
        commandKey: item.commandKey,
        title: item.title,
        description: item.description,
        icon: item.icon,
    })))
}
