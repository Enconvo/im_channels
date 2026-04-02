import { ChannelConnectionManager } from "../connection_manager.ts";

interface ChannelToolsParams {
    /** The agent command key to get tools for @required */
    agent_command_key: string;
}

/**
 * Returns a summary string for system prompt injection with channel status and tool schemas
 * @param {Request} request - Request object, body is {@link ChannelToolsParams}
 * @returns Summary string for the agent's bound channels, or null if none
 * @private
 */
export default async function main(request: Request) {
    const params = (await request.json()) as ChannelToolsParams;
    const { agent_command_key } = params;

    if (!agent_command_key) {
        return Response.json({ error: "Missing required field: agent_command_key" }, { status: 400 });
    }

    const connections = ChannelConnectionManager.shared().getLocalActive();
    const boundConnections = connections.filter(c => c.agentCommandKey === agent_command_key);

    if (boundConnections.length === 0) {
        return Response.json({ summary: null });
    }

    const parts: string[] = [];

    for (const conn of boundConnections) {
        const status = conn.status === "active" ? "ONLINE" : conn.status;
        const tools = conn.provider.getTools();

        let section = `### ${conn.provider.displayName} — ${status}\n`;
        section += `channel_provider: \`"${conn.channelProvider}"\`\n\n`;

        for (const tool of tools) {
            const toolParams = tool.parameters?.properties || {};
            const required = tool.parameters?.required || [];
            const paramLines = Object.entries(toolParams)
                .map(([name, schema]: [string, any]) => {
                    const req = required.includes(name) ? " (required)" : "";
                    return `  - \`${name}\`: ${schema.description || schema.type}${req}`;
                });
            section += `**${tool.tool_name}** — ${tool.description}\n`;
            if (paramLines.length > 0) {
                section += `Parameters:\n${paramLines.join("\n")}\n`;
            }
            section += "\n";
        }

        parts.push(section);
    }

    return Response.json({ summary: parts.join("\n") });
}
