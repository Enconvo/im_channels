import { CommandManageUtils, NativeAPI } from "@enconvo/api";

/** Request params for agent_channel_providers */
interface AgentChannelProvidersParams {
    /** The agent Id (command key) (e.g. "agent|main") @required */
    agentId: string
}

/** Provider info plus its access control configuration */
interface AgentChannelProvider {
    /** Short channel name (e.g. "telegram", "discord") */
    name: string
    /** Full provider command key (e.g. "im_channels|telegram") */
    commandKey: string
    /** Base provider command key when this is a user-created channel */
    targetCommand: string | null
    /** Human-readable display title */
    title: string
    /** Provider description */
    description: string
    /** Icon filename */
    icon: string | null
    /** Whether real-time message listening is enabled */
    enabled: boolean
    /** Access control configuration (policy, allowList, pending pairings) */
    access: any
}

/**
 * Get all IM channel providers bound to a given agent, including each provider's basic info and access control configuration (policy, allowList, pending pairings). An agent can be bound to many channel providers; each provider is bound to at most one agent.
 * @param {Request} request - Request object, body is {@link AgentChannelProvidersParams}
 * @returns Object with `providers`: array of {@link AgentChannelProvider}
 */
export default async function main(request: Request) {
    const params = (await request.json()) as AgentChannelProvidersParams;
    const { agentId } = params;

    if (!agentId) {
        return Response.json({ error: "Missing agentId" }, { status: 400 });
    }

    const results = (await NativeAPI.localApi("search/providers", {
        category: "im_channel",
    } as any).then(r => r.json())) as any[];

    const providers: AgentChannelProvider[] = [];

    for (const item of results) {
        const config = (await CommandManageUtils.loadCommandConfig({
            commandKey: item.commandKey,
            includes: ["bound_agent", "enabled", "access"],
        })) as Record<string, any> | null;

        if (config?.bound_agent !== agentId) continue;

        providers.push({
            name: item.name,
            commandKey: item.commandKey,
            targetCommand: item.targetCommand || null,
            title: item.title,
            description: item.description,
            icon: item.icon || null,
            enabled: !!config?.enabled,
            access: config?.access ?? null,
        });
    }

    return Response.json({ providers });
}
