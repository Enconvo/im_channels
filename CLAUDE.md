# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Enconvo extension providing unified IM channel integration for Slack, Telegram, Discord, and Feishu/Lark. Exposes API endpoints for sending/reading messages consumed by `chat_with_ai` as LLM tools. Credentials are stored as command preferences directly on each provider command — no external credentials module.

## Build & Development Commands

```bash
npm run dev        # Watch mode with hot reload (enconvo dev --dev)
npm run build      # Production build (enconvo dev)
npm run lint       # ESLint check
npm run format     # Prettier format all .ts files
```

Package manager: **pnpm**. No automated tests — verify by building and manual testing.

### Testing API Endpoints

After building, test API endpoints via the local HTTP API (port 54535):
```bash
curl -X POST http://localhost:54535/api/im_channels/launched_channels \
    -H "Content-Type: application/json" -d '{}'
```
Replace the path for other endpoints: `http://localhost:54535/api/im_channels/{endpoint}`

## Architecture

### Data Flow

```
chat_with_ai agent
  → NativeAPI.api("im_channels/send_message", {...})
  → API endpoint (src/api/send_message.ts)
  → channel_registry.ts (cached providers)
  → SlackProvider / TelegramProvider / DiscordProvider / FeishuProvider
  → Platform HTTP API / WebSocket
```

### Credential Flow

Providers never read env vars. Credentials live as `password` preferences on each provider command in `package.json`:

1. `channel_registry.ts` calls `CommandManageUtils.loadCommandConfig({commandKey: "im_channels|{platform}_channel", decrypt: true})`
2. Returns decrypted preferences (e.g., `{botToken: "xoxb-..."}`)
3. `provider.initialize(credentials)` injects tokens; `provider.isReady()` gates availability
4. `loadProviders()` caches results — called once per process

### Provider Implementations

All implement `ChannelProvider` interface from `src/types.ts`. Files live in `src/` matching command names.

| Provider | File | Transport | Listener | Max Length |
|----------|------|-----------|----------|------------|
| Slack | `slack_channel.ts` | HTTPS Web API | Socket Mode WebSocket (`xapp-` token) | 4000 |
| Telegram | `telegram_channel.ts` | HTTPS Bot API | Long-polling getUpdates (30s) | 4096 |
| Discord | `discord_channel.ts` | HTTPS REST v10 | Gateway WebSocket (raw opcodes, no discord.js) | 2000 |
| Feishu | `feishu_channel.ts` | HTTPS Open API | Polling (placeholder) | 4000 |

**Notable details:**
- Discord: raw HTTP + Gateway WebSocket, 2s debounce for rapid @mentions
- Feishu: auto-refreshes tenant access tokens with 60s early expiry buffer
- All providers use `fetch()` + native `WebSocket` — no heavy IM SDKs

### Agent-Channel Relation System

Managed by `src/channel_relations.ts`. Stored via `PreferenceManageUtils` at key `channel_relations`.

- **One agent → many channels** (an agent can have Slack, Telegram, etc.)
- **One channel → one agent** (each channel bound to exactly one agent)
- Key format: `{platform}:{channelId}` → `agentCommandKey`
- Channel → Agent lookup is O(1); Agent → Channels is O(n) filter

When `channel_listener_service` receives an incoming message:
1. `getChannelAgent(platform, channelId)` finds the bind agent
2. If bound: loads agent config, uses its system prompt + LLM
3. If unbound: falls back to default LLM

### API Endpoints (auto-discovered from `src/api/`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `configured_channels` | GET | List ready providers |
| `send_message` | POST | Send message to channel |
| `read_messages` | POST | Read messages from channel |
| `get_channel_tools` | GET | AITool[] definitions for chat_with_ai |
| `bind_channel` | POST | Bind channel to agent |
| `unbind_channel` | POST | Unbind channel |
| `agent_channels` | POST | Get all channels for an agent |
| `channel_agent` | POST | Get agent for a channel |
| `list_bindings` | GET | List all bindings |

### Shared Utilities (`src/utils.ts`)

- `withRetry()` — exponential backoff, rate-limit aware (429 + `retry_after`)
- `splitMessage()` — smart chunking: prefers newline > space > hard-cut
- `sleep()` — promise-based delay

## Cross-Module Integration

- **`chat_with_ai`** — consumes this module via `channel_bridge.ts` calling `NativeAPI.api("im_channels/...")`
- All providers use raw `fetch()` — no dependency on credentials module

## Adding a New Platform

1. `src/{name}_channel.ts` — implement `ChannelProvider` + `export default async function main`
2. `package.json` — add provider command with credential preferences (password type for tokens)
3. `src/channel_registry.ts` — add to `PROVIDERS` map with command key `im_channels|{name}_channel`
4. Build: `npx enconvo dev`
