import { NativeAPI } from "@enconvo/api";

/**
 * Returns agent list formatted for dropdown dataProxy, used by the bound_agent preference dropdown
 * @param {Request} request - Request object (no body required)
 * @returns Dropdown items with title, value, description, and icon
 * @private
 */
export default async function main(request: Request) {
    const response = await NativeAPI.localApi("agent/list", {} as any);
    const agents = await response.json();

    if (!Array.isArray(agents)) {
        return Response.json([]);
    }

    const items = agents.map((agent: any) => ({
        title: agent.title || agent.name || "Unknown",
        value: agent.agent_id || agent.commandKey || "",
        description: agent.description || "",
        icon: agent.icon || "",
    }));

    return Response.json(items);
}
