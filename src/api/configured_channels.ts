import { CommandManageUtils, NativeAPI } from "@enconvo/api";
import { ChannelConnectionManager } from "../connection_manager.ts";

interface ProviderInfo {
    name: string;
    commandKey: string;
    targetCommand: string | null;
    title: string;
    description: string;
    icon: string | null;
    from: string | null;
    configured: boolean;
    enabled: boolean;
    boundAgent: string | null;
    launched: boolean;
    preferences: any[] | undefined;
}

/**
 * Returns all IM channel provider commands with configured status, enabled state, bound agent, and launch status
 * @param {Request} request - Request object (no body required)
 * @returns Array of channel providers with their configuration and launch state
 */
export default async function main(_request: Request) {
    const results = (await NativeAPI.localApi("search/providers", {
        category: "im_channel",
    } as any).then(r => r.json())) as any[];

    const channels: ProviderInfo[] = [];

    for (const item of results) {
        let configured = false;
        let enabled = false;
        let boundAgent: string | null = null;

        try {
            const config = await CommandManageUtils.loadCommandConfig({
                commandKey: item.commandKey,
                decrypt: true,
            }) as Record<string, any> | null;

            if (config) {
                // Check if any credential field has a value (exclude enabled/bound_agent)
                const credentialKeys = Object.keys(config).filter(
                    k => k !== "enabled" && k !== "bound_agent",
                );
                const values = credentialKeys
                    .map(k => config[k])
                    .filter(v => typeof v === "string" && v.length > 0);
                configured = values.length > 0;
                enabled = !!config.enabled;
                boundAgent = config.bound_agent || null;
            }
        } catch {
            // Not configured
        }

        const launched = ChannelConnectionManager.shared().isLaunched(item.commandKey);

        channels.push({
            name: item.name,
            commandKey: item.commandKey,
            targetCommand: item.targetCommand || null,
            title: item.title,
            description: item.description,
            icon: item.icon || null,
            from: item.from || null,
            configured,
            enabled,
            boundAgent,
            launched,
            preferences: item.preferences,
        });
    }

    return Response.json({ channels });
}
