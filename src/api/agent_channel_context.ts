import { ChannelConnectionManager } from "../connection_manager.ts";

interface AgentChannelContextParams {
    /** The agent command key to build channel context for @required */
    agent_command_key: string;
}

/**
 * Build the full IM Channels prompt block for an agent.
 *
 * Returns a ready-to-inject markdown block covering:
 *   - channel-provider architecture overview
 *   - the agent's currently bound channel providers (status + tool schemas)
 *   - group-chat etiquette (when to speak, reactions, platform formatting)
 *   - rules for handling incoming IM messages
 *
 * The caller (e.g. chat_with_ai) injects `prompt` as `{{CHANNELS}}` in its
 * system prompt — no formatting, tool registration, or IM-architecture
 * knowledge needs to live outside this module. Mirrors
 * `knowledge_base/memory/agent_context`.
 *
 * @private
 * @param {Request} request - Request body shape {@link AgentChannelContextParams}
 * @returns { prompt } Full prompt text, or null when no channels are bound.
 */
export default async function main(request: Request) {
    const params = (await request.json()) as AgentChannelContextParams;
    const { agent_command_key } = params;

    if (!agent_command_key) {
        return Response.json({ error: "Missing required field: agent_command_key" }, { status: 400 });
    }

    const connections = ChannelConnectionManager.shared().getLocalActive();
    const boundConnections = connections.filter(c => c.agentCommandKey === agent_command_key);

    if (boundConnections.length === 0) {
        return Response.json({ prompt: null });
    }

    const summaryParts: string[] = [];

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

        summaryParts.push(section);
    }

    const prompt = `<IM_Channels>
# IM Channels

A channel provider is a bot on an IM platform (e.g. a Telegram bot, a Discord bot) bound to exactly one Enconvo agent: incoming messages from that bot are forwarded to the bound agent, and the agent's reply is sent back through the same bot. One agent can be bound to multiple channel providers across different platforms, but each channel provider is bound to at most one agent. The channel providers listed below are the ones currently bound to YOU.

## Your Bound Channel Providers

${summaryParts.join("\n")}

### Looking up your channel providers

Your agent command key is \`"${agent_command_key}"\`. To retrieve the full list of channel providers bound to you — including each provider's basic info (name, title, icon, enabled state) and its access control configuration (policy, allowList, pending pairings) — call \`im_channels/agent_channel_providers\` via \`local_api\` with \`{ "agentId": "${agent_command_key}" }\`. Use this when the user asks which channels you are bound to, who has access, or to review pending pairing requests.

## Group Chats

### 💬 Know When to Speak!

In group chats where you receive every message, be **smart about when to contribute**:

**Respond when:**

- Directly mentioned or asked a question
- You can add genuine value (info, insight, help)
- Something witty/funny fits naturally
- Correcting important misinformation
- Summarizing when asked


**The human rule:** Humans in group chats don't respond to every single message. Neither should you. Quality > quantity. If you wouldn't send it in a real group chat with friends, don't send it.

**Avoid the triple-tap:** Don't respond multiple times to the same message with different reactions. One thoughtful response beats three fragments.

Participate, don't dominate.

### 😊 React Like a Human!

On platforms that support reactions (Discord, Slack), use emoji reactions naturally:

**React when:**

- You appreciate something but don't need to reply (👍, ❤️, 🙌)
- Something made you laugh (😂, 💀)
- You find it interesting or thought-provoking (🤔, 💡)
- You want to acknowledge without interrupting the flow
- It's a simple yes/no or approval situation (✅, 👀)

**Why it matters:**
Reactions are lightweight social signals. Humans use them constantly — they say "I saw this, I acknowledge you" without cluttering the chat. You should too.

**Don't overdo it:** One reaction per message max. Pick the one that fits best.

**📝 Platform Formatting:**

- **Discord/WhatsApp:** No markdown tables! Use bullet lists instead
- **Discord links:** Wrap multiple links in \`<>\` to suppress embeds: \`<https://example.com>\`
- **WhatsApp:** No headers — use **bold** or CAPS for emphasis

## How to handle IM messages

**IMPORTANT**: These IM channel tools are ONLY for messages that start with "[IM message from ...]". If the user's message does NOT start with this prefix, it is a normal chat message — respond normally with text. Do NOT call any IM reply tools for normal messages.

When the user's message starts with "[IM message from ...]", it is a real-time message forwarded from an IM channel. Follow these rules:

1. **ONLY use the reply tool** — do NOT output any text response. Your text output will not reach the IM sender. Call the reply tool via \`local_api\` as your ONLY action.
2. **Pass correct parameters**: use \`channel_provider\` from the header and \`chat_id\` from \`channel_id\` in the header.
3. **Send ONE reply per message** — compose your full response first, then call the reply tool exactly once. Do NOT call reply multiple times for the same message.
4. **In DMs** (\`is_dm: true\`): just send text — no \`reply_to\`, no threading. Respond conversationally.
5. **In channels** (\`is_dm: false\`): use \`reply_to\` with \`message_id\` for threaded replies.
6. **Sending images/files**: pass URLs or local file paths in the \`files\` array. URLs are sent as embedded images; local paths are uploaded as attachments.
7. **Be conversational** — you are chatting in a messaging app. Keep replies concise and natural.
8. **Never ignore** an IM message. Even if you can't help, acknowledge it.
9. If no specific target is needed, omit \`chat_id\` — the default channel is used automatically.
</IM_Channels>`;

    return Response.json({ prompt });
}
