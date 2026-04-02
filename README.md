# IM Channels — Architecture & Developer Guide

## What This Module Does

Provides a unified interface for sending and reading messages across IM platforms (Slack, Telegram, Discord, Feishu/Lark). Exposes API endpoints that the `chat_with_ai` agent calls to give LLMs messaging capabilities.

## Architecture

```
                  Enconvo Settings UI
                         │
                         ▼
              ┌─────────────────────┐
              │  credentials module │   Encrypted storage for bot tokens
              │                     │   (slack_im, telegram_im,
              │  ┌───────────────┐  │    discord_im, feishu_im)
              │  │ botToken: *** │  │
              │  │ appSecret: ** │  │
              │  └───────────────┘  │
              └────────┬────────────┘
                       │ CommandManageUtils.loadCommandConfig()
                       ▼
              ┌─────────────────────────────────────────────────┐
              │              im_channels module                  │
              │                                                  │
              │  channel_registry.ts                             │
              │    │  Loads credentials → instantiates providers │
              │    ▼                                             │
              │  ┌────────────┐ ┌─────────────┐ ┌────────────┐ │
              │  │   Slack    │ │  Telegram   │ │  Discord   │ │
              │  │  Provider  │ │  Provider   │ │  Provider  │ │
              │  │  (HTTP +   │ │  (HTTP      │ │  (HTTP +   │ │
              │  │  Socket    │ │   long-     │ │  Gateway   │ │
              │  │  Mode WS)  │ │   poll)     │ │  WS)       │ │
              │  └────────────┘ └─────────────┘ └────────────┘ │
              │                                                  │
              │  ┌────────────┐                                 │
              │  │  Feishu    │                                 │
              │  │  Provider  │                                 │
              │  │  (HTTP +   │                                 │
              │  │  token     │                                 │
              │  │  refresh)  │                                 │
              │  └────────────┘                                 │
              │                                                  │
              │  API Endpoints:                                  │
              │    /configured_channels  → list ready providers  │
              │    /send_message         → send to platform      │
              │    /read_messages        → read from platform    │
              │    /get_channel_tools    → tool defs for agent   │
              │                                                  │
              │  channel_listener_service.ts                     │
              │    Background service: listens on all platforms,  │
              │    replies via LLM                               │
              └───────────────┬─────────────────────────────────┘
                              │ NativeAPI.api("im_channels/...")
                              ▼
              ┌────────────────────────────┐
              │       chat_with_ai         │
              │                            │
              │  channel_bridge.ts         │
              │    Thin async wrapper      │
              │    → loadChannelTools()    │
              │    → send/read via API     │
              │                            │
              │  chat_command.ts           │
              │    if (await hasAny...)     │
              │      tools.push(channels)  │
              └────────────────────────────┘
```

## Data Flow: Sending a Message

```
1. User asks agent: "Send 'hello' to my Telegram chat"
2. chat_with_ai agent invokes tool: send_channel_message(platform="telegram", channel_id="123", content="hello")
3. channel_bridge.ts → NativeAPI.api("im_channels/send_message", {platform, channel_id, content})
4. send_message.ts API endpoint → loadProviders() → finds TelegramProvider
5. TelegramProvider.sendMessage() → POST https://api.telegram.org/bot.../sendMessage
6. Result propagates back: {success: true, messageCount: 1}
7. Agent reports: "Message sent to Telegram channel 123."
```

## Data Flow: Credential Loading

```
1. channel_registry.ts iterates PROVIDERS map
2. For each: CommandManageUtils.loadCommandConfig({commandKey: "credentials|slack_im", decrypt: true})
3. Enconvo decrypts stored preferences → returns {botToken: "xoxb-...", appToken: "xapp-..."}
4. new SlackProvider().initialize(credentials) → stores tokens in memory
5. provider.isReady() checks if required tokens are present
6. Only ready providers are returned to callers
```

## Directory Structure

```
im_channels/
├── package.json              # 4 provider commands + 1 service command
├── tsconfig.json
├── assets/icon.png
├── src/
│   ├── providers/
│   │   ├── types.ts          # ChannelProvider interface, ChannelMessage, SendResult
│   │   ├── utils.ts          # withRetry (rate-limit aware), splitMessage, sleep
│   │   ├── slack_provider.ts     # Slack Web API + Socket Mode WebSocket
│   │   ├── telegram_provider.ts  # Telegram Bot API + long-polling
│   │   ├── discord_provider.ts   # Discord REST + Gateway WebSocket (no discord.js)
│   │   └── feishu_provider.ts    # Feishu REST + auto token refresh
│   ├── channel_registry.ts   # Loads credentials, instantiates & caches providers
│   ├── channel_listener_service.ts  # Background service: bot listeners + LLM reply
│   └── api/
│       ├── configured_channels.ts   # GET: list configured channel names
│       ├── send_message.ts          # POST: send message to platform
│       ├── read_messages.ts         # POST: read messages from platform
│       └── get_channel_tools.ts     # GET: AITool[] definitions for chat_with_ai
└── skills/
    ├── SKILL.md              # Auto-generated API reference
    ├── schemas.json          # Auto-generated parameter schemas
    └── im-channels-setup/    # Setup wizard skill
        ├── SKILL.md
        └── references/
            ├── setup-guides.md
            └── token-validation.md
```

## ChannelProvider Interface

Every provider implements this interface. Credentials are injected via `initialize()`, never read from env vars.

```typescript
interface ChannelProvider {
    readonly name: string;              // "slack" | "telegram" | "discord" | "feishu"
    readonly displayName: string;
    readonly maxMessageLength: number;  // Slack: 4000, Telegram: 4096, Discord: 2000, Feishu: 4000

    initialize(credentials: Record<string, string>): Promise<void>;
    isReady(): boolean;
    sendMessage(channelId: string, content: string): Promise<SendResult>;
    readMessages(channelId: string, limit?: number): Promise<ChannelMessage[]>;
    startListener(handler: BotReplyHandler): Promise<void>;
    stopListener(): Promise<void>;
    destroy(): Promise<void>;
}
```

## Provider Implementation Details

| Provider | Transport | Listener Mechanism | Auth |
|----------|-----------|-------------------|------|
| Slack | HTTPS (Web API) | Socket Mode WebSocket (`xapp-` token) | `Bearer {botToken}` header |
| Telegram | HTTPS (Bot API) | Long-polling `getUpdates` (30s timeout) | Token in URL path |
| Discord | HTTPS (REST v10) | Gateway WebSocket (op2 IDENTIFY + heartbeat) | `Bot {token}` header |
| Feishu | HTTPS (Open API) | Polling (placeholder — prod should use event subscription) | `Bearer {tenant_access_token}` (auto-refresh) |

### Discord: No discord.js

Discord uses raw HTTP + Gateway WebSocket instead of the ~1.5MB discord.js library:
- **REST**: `fetch("https://discord.com/api/v10/channels/{id}/messages", ...)`
- **Gateway**: Connect to `wss://gateway.discord.gg/?v=10&encoding=json`, handle opcodes (10=Hello, 0=Dispatch, 1=Heartbeat, 2=Identify)
- **Message batching**: 2-second debounce groups rapid @mentions into a single handler call

### Feishu: Token Management

Feishu uses short-lived tenant access tokens (2-hour expiry). The provider auto-refreshes:
```
POST /open-apis/auth/v3/tenant_access_token/internal
  {app_id, app_secret} → {tenant_access_token, expire}
```
Tokens are cached and refreshed 60 seconds before expiry.

## Adding a New Platform

1. Create `src/providers/{name}_provider.ts` implementing `ChannelProvider`
2. Create `modules/credentials/src/{name}_im.ts` extending `AuthProvider` with validation
3. Register credential command in `modules/credentials/package.json`
4. Add entry to `PROVIDERS` map in `src/channel_registry.ts`
5. Add setup guide in `skills/im-channels-setup/references/setup-guides.md`
6. Add validation command in `skills/im-channels-setup/references/token-validation.md`
7. Build both modules: `cd modules/credentials && npx enconvo dev && cd ../im_channels && npx enconvo dev`
