---
name: im_channels
description: >
  IM channel integration for Telegram and Discord with platform-specific tools and persistent channel listeners.
metadata:
  author: ysnows
  version: "0.0.8"
---

# IM Channels — Setup & Management

You are helping the user set up IM channel integrations for Enconvo. Supported platforms: **Discord** and **Telegram**.

The skill directory (SKILL_DIR) is wherever this SKILL.md lives. Find it via: `**/im_channels/skills/SKILL.md`

## Platform Reference Files

Detailed setup guides with step-by-step instructions live in `references/`:

| File | Content |
|------|---------|
| `references/discord.md` | Discord bot creation, token, intents, invite URL, channel IDs, validation, Browser Control steps |
| `references/telegram.md` | Telegram BotFather setup, chat IDs, validation |

Read the relevant reference file when guiding the user through a specific platform.

## Command Parsing

Parse the user's intent from `$ARGUMENTS`:

| User says (examples) | Subcommand |
|---|---|
| `create discord bot`, `create telegram bot`, `新建Discord机器人` | create \<platform\> |
| `setup`, `configure`, `add channel`, `设置`, `配置通道` | setup |
| `status`, `which channels`, `list channels`, `什么通道已配置` | status |
| `validate`, `test connection`, `验证`, `测试连接` | validate |
| `help discord`, `help telegram` | help \<platform\> |

If no subcommand is clear, default to `setup`.

## Overview: How It All Connects

```
┌─────────────────────────┐     ┌──────────────────────────┐
│  Enconvo Settings UI    │     │   im_channels module     │
│                         │     │                          │
│  IM Channels section:   │────▶│  DiscordProvider         │
│  - Discord              │     │  TelegramProvider        │
│  - Telegram             │     │                          │
└─────────────────────────┘     └──────────────────────────┘
                                         │
                                         ▼
                                 chat_with_ai agent
                                 (discord_actions/reply,
                                  telegram_actions/reply, etc.)
```

**User flow:**
1. Create a bot on the platform (Discord Developer Portal / Telegram BotFather)
2. Open **Enconvo Settings > IM Channels** → add a channel for the platform
3. Paste bot token, select a bound agent, toggle Enabled
4. The bound agent automatically gets reply/react/fetch tools injected

## API Reference

Just use the `local_api` tool to request these APIs.

| Endpoint | Description |
|----------|-------------|
| `im_channels/check_connection` | Check if a channel's credentials are valid by calling the platform API. Params: `channel_provider` (string, required) |
| `im_channels/configured_channels` | Returns all IM channel provider commands with configured status, enabled state, bound agent, and launch status. _No params_ |
| `im_channels/create_channel` | Create a new channel by duplicating the base provider command for a platform. Params: `platform` (string, required), `title` (string), `bound_agent` (string) |
| `im_channels/launch_channel` | Launch a channel listener for a provider, reading config from preferences or using credential overrides. _7 params — use `check_local_api_schemas` tool_ |
| `im_channels/launched_channels` | List all currently active channel connections from shared state. _No params_ |
| `im_channels/restore_channels` | Restore all enabled channels, called on app startup or manually. _No params_ |
| `im_channels/stop_channel` | Stop a running channel listener. Params: `channel_provider` (string, required) |
| `im_channels/typing_indicator` | Send a typing indicator to a channel, best-effort with errors silently ignored. Params: `channel_provider` (string, required), `channel_id` (string, required) |
| `im_channels/discord_actions/bot_api` | Call any Discord REST API endpoint directly. The bot token and base URL are injected automatically — you only need to specify the HTTP method, path, and optional body. This is a generic passthrough to the Discord API v10. Use it for any endpoint not covered by the dedicated tools (reply, edit_message, react, fetch_messages, download_attachment). Image fields (`avatar`, `icon`, `image`, `splash`, `banner`) accept a local file path (starting with "/") — it will be auto-converted to a base64 data URI as Discord requires. You can also use `local_api enconvo/upload_file {"filePath": "/path/to/file"}` to get a hosted URL. Common endpoints: Bot profile: - `GET /users/@me` — get bot user info (username, id, avatar hash, etc.) - `PATCH /users/@me` — update bot profile. Body: `{"username": "New Name", "avatar": "/path/to/image.png"}` Server (Guild) info: - `GET /guilds/{guild_id}` — get server info (name, icon, owner, member count) - `GET /guilds/{guild_id}/channels` — list all channels in a server - `GET /guilds/{guild_id}/members?limit=100` — list server members - `GET /guilds/{guild_id}/roles` — list server roles - `PATCH /guilds/{guild_id}` — modify server (name, icon, etc.) Channel management: - `GET /channels/{channel_id}` — get channel info (name, topic, type) - `PATCH /channels/{channel_id}` — modify channel (name, topic, permissions) - `DELETE /channels/{channel_id}` — delete a channel - `POST /guilds/{guild_id}/channels` — create a new channel. Body: `{"name": "new-channel", "type": 0}` Messages: - `POST /channels/{channel_id}/messages` — send a message. Body: `{"content": "Hello!"}` - `GET /channels/{channel_id}/messages?limit=50` — get recent messages - `PATCH /channels/{channel_id}/messages/{message_id}` — edit a message - `DELETE /channels/{channel_id}/messages/{message_id}` — delete a message - `PUT /channels/{channel_id}/pins/{message_id}` — pin a message - `DELETE /channels/{channel_id}/pins/{message_id}` — unpin a message Member management: - `GET /guilds/{guild_id}/members/{user_id}` — get a member's info - `PATCH /guilds/{guild_id}/members/{user_id}` — modify member (nickname, roles). Body: `{"nick": "New Nick"}` - `PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id}` — add role to member - `DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id}` — remove role from member - `PUT /guilds/{guild_id}/bans/{user_id}` — ban a member - `DELETE /guilds/{guild_id}/bans/{user_id}` — unban a member - `DELETE /guilds/{guild_id}/members/{user_id}` — kick a member Reactions: - `PUT /channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me` — add reaction - `DELETE /channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me` — remove reaction Invites: - `POST /channels/{channel_id}/invites` — create invite. Body: `{"max_age": 86400, "max_uses": 10}` - `GET /guilds/{guild_id}/invites` — list server invites Full reference: https://discord.com/developers/docs/reference. _4 params — use `check_local_api_schemas` tool_ |
| `im_channels/discord_actions/download_attachment` | Download all attachments from a Discord message to local inbox directory. Params: `channel_provider` (string, required), `channel_id` (string, required), `message_id` (string, required) |
| `im_channels/discord_actions/edit_message` | Edit a message the bot previously sent in Discord. _4 params — use `check_local_api_schemas` tool_ |
| `im_channels/discord_actions/fetch_messages` | Pull recent message history from a Discord channel sorted oldest-first. Params: `channel_provider` (string, required), `channel_id` (string, required), `limit` (number, default: 50) |
| `im_channels/discord_actions/react` | Add an emoji reaction to a Discord message by ID. _4 params — use `check_local_api_schemas` tool_ |
| `im_channels/discord_actions/reply` | Send a message to a Discord channel or DM with optional file attachments and threading. _6 params — use `check_local_api_schemas` tool_ |
| `im_channels/telegram_actions/bot_api` | Call any Telegram Bot API method directly. The bot token is injected automatically — you only need to specify the method name and its parameters. This is a generic passthrough to the Telegram Bot API. Use it for any method not covered by the dedicated tools (reply, edit_message, react). File upload: any value that is a local file path (starting with "/") or a URL (http/https) inside params — at any nesting depth — will be automatically downloaded and uploaded via multipart/form-data using Telegram's `attach://` syntax. This works for top-level fields and nested InputFile fields (e.g. InputProfilePhoto). You can also use `local_api enconvo/upload_file {"filePath": "/path/to/file"}` to upload a file first and get a hosted URL. Common methods: - `getMe` — get bot info (username, id, etc.) - `setMyProfilePhoto` — set bot's own profile photo. Params: `{"photo": {"type": "static", "photo": "/path/to/image.png"}}` or `{"photo": {"type": "static", "photo": "https://..."}}` - `deleteMyProfilePhoto` — remove bot's profile photo - `setMyName` — change bot display name. Params: `{"name": "New Name"}` - `setMyDescription` — change bot description. Params: `{"description": "text"}` - `setMyShortDescription` — change bot short description shown in profile - `setChatPhoto` — set group chat photo (bot must be admin). Params: `{"chat_id": "...", "photo": "/path/to/photo.png"}` - `deleteChatPhoto` — remove group chat photo - `getChat` — get chat details. Params: `{"chat_id": "..."}` - `getChatMemberCount` — count members. Params: `{"chat_id": "..."}` - `getChatMember` — get a specific member's info. Params: `{"chat_id": "...", "user_id": 123}` - `banChatMember` / `unbanChatMember` — moderation - `pinChatMessage` / `unpinChatMessage` — pin/unpin messages - `setMyCommands` — set bot command menu. Params: `{"commands": [{"command": "start", "description": "Start the bot"}]}` - `deleteMyCommands` — remove bot command menu - `getMyCommands` — list current bot commands - `setChatMenuButton` — set bot menu button - `sendSticker` — send a sticker. Params: `{"chat_id": "...", "sticker": "/path/to/sticker.webp"}` - `createNewStickerSet` / `addStickerToSet` — sticker set management - `getCustomEmojiStickers` — get custom emoji stickers by IDs - `setMessageReaction` — react to a message (also available as dedicated `react` tool) - `forwardMessage` — forward a message. Params: `{"chat_id": "...", "from_chat_id": "...", "message_id": 123}` - `copyMessage` — copy a message without "forwarded" label - `exportChatInviteLink` — generate invite link for a group - `setChatTitle` / `setChatDescription` — change group title/description - `leaveChat` — make the bot leave a chat Full reference: https://core.telegram.org/bots/api. Params: `channel_provider` (string, required), `method` (string, required), `params` (object) |
| `im_channels/telegram_actions/edit_message` | Edit a message the bot previously sent in Telegram. _4 params — use `check_local_api_schemas` tool_ |
| `im_channels/telegram_actions/react` | Add an emoji reaction to a Telegram message by ID. _4 params — use `check_local_api_schemas` tool_ |
| `im_channels/telegram_actions/reply` | Send a message to a Telegram chat with optional file attachments and threading. _5 params — use `check_local_api_schemas` tool_ |


## Browser Control Integration

Before guiding manual steps, check if the `browser_control` extension is installed. If it is, you can automate the Discord Developer Portal workflow.

**How to check:**
```
local_api enconvo/get_extension_info {"extension_name": "browser_control"}
```

If the extension exists (response has `commands`), Browser Control is available. Use its tools to automate browser interactions:

| Tool | Purpose |
|------|---------|
| `browser_control/navigate` | Open a URL |
| `browser_control/click` | Click a button/element |
| `browser_control/fill` | Fill a text field |
| `browser_control/get_text` | Read text from page |
| `browser_control/screenshot` | Take a screenshot to verify state |
| `browser_control/snapshot` | Get page DOM snapshot |
| `browser_control/wait_for` | Wait for element to appear |

Each reference file includes `### Browser Control automation` sections with the element targets for each step.

---

## Subcommands

### `create <platform>`

**This is the primary workflow when a user says "create a Discord/Telegram bot".**

The goal is to walk the user through creating a new bot on the platform AND connecting it to Enconvo — end to end.

#### Step 0 — Detect Browser Control

Check if `browser_control` is installed:
- **If YES**: Tell the user you can automate most of the setup. Ask if they want automated or manual guidance.
- **If NO**: Tell the user you'll provide step-by-step instructions. Suggest installing Browser Control for a more automated experience next time.

#### Step 1 — Create the bot on the platform

Read the relevant `references/<platform>.md` file for the full workflow.

**Discord (automated with Browser Control):**
1. Navigate to `https://discord.com/developers/applications`
2. If not logged in, take a screenshot and ask the user to log in first
3. Click "New Application" → fill in the name → click "Create"
4. Navigate to Bot tab → enable Message Content Intent → Save
5. Reset/copy the bot token
6. Navigate to OAuth2 → generate invite URL with correct permissions
7. Open the invite URL → let user select their server
8. After each major step, take a screenshot to confirm success

**Discord (manual — no Browser Control):**
Provide the step-by-step instructions from `references/discord.md`. Format them clearly with numbered steps. Offer to validate the token once the user has it.

**Telegram (always interactive):**
Telegram bots are created via @BotFather in the Telegram app — no browser automation needed.
1. Tell the user to open Telegram and message `@BotFather`
2. Send `/newbot`, choose a name and username
3. Copy the token BotFather provides
4. Provide the instructions from `references/telegram.md`

#### Step 2 — Create the channel in Enconvo

Once the user has the bot token:

1. Call `local_api im_channels/create_channel {"platform": "<discord|telegram>"}` to create a new channel instance
2. Tell the user to open **Enconvo Settings > IM Channels**
3. They should see the new channel — paste the bot token there
4. Select a bound agent
5. Toggle Enabled

Or if you have the token directly, you can launch it:
```
local_api im_channels/launch_channel {
  "channel_provider": "<the_new_channel_provider_key>",
  "botToken": "<token>"
}
```

#### Step 3 — Validate

Call `local_api im_channels/check_connection {"channel_provider": "<channel_key>"}` to verify the token works.

Report the result:
- **OK**: "Connected as [bot_name]. Your bot is ready!"
- **FAIL**: Explain what went wrong and how to fix it

#### Step 4 — Test

Suggest the user send a test message to the bot:
- **Discord**: Send a message in the server channel where the bot is present
- **Telegram**: Send a message directly to the bot

The bound agent should respond automatically.

### `setup`

Guide the user through setting up one or more IM channels. Use AskUserQuestion to collect input interactively.

**Step 1 — Choose platforms**

Ask which platforms to set up:

- **Discord** — For servers/guilds. Needs a Bot Token from the Developer Portal. Uses Gateway WebSocket.
- **Telegram** — Best for personal use. Just needs a Bot Token from @BotFather.

**Step 2 — Collect credentials per platform**

For each selected platform, guide the user to obtain and enter credentials. Tell them where to find each value in one sentence. Only show the full guide (from the corresponding `references/<platform>.md` file) if the user asks for help.

Always mask secrets when confirming back (show only last 4 characters).

- **Discord**: Bot Token (required), enable Message Content Intent, invite bot to server
- **Telegram**: Bot Token (required, from @BotFather)

After collecting, tell the user to open **Enconvo Settings > IM Channels** and paste the tokens there.

**Step 3 — Validate credentials**

After the user has entered credentials, offer to validate them using `im_channels/check_connection`.

**Step 4 — Confirm setup**

Tell the user:
> Your channel is configured! The bound agent will now respond to messages from this channel automatically. Send a test message to verify everything works.

### `status`

Check which channels are currently configured and active:

1. Call `local_api im_channels/configured_channels`
2. Display the result as a table:

```
| Channel          | Configured | Enabled | Connected |
|------------------|------------|---------|-----------|
| Discord          | Yes        | Yes     | Online    |
| Telegram         | Yes        | No      | Offline   |
| Discord (copy 2) | No        | No      | Offline   |
```

If no channels are configured, suggest running `create discord` or `create telegram`.

### `validate`

Re-validate all configured channel credentials:

1. Call `local_api im_channels/configured_channels` to find configured channels
2. For each configured channel, call `im_channels/check_connection`
3. Report results with a summary table

### `help <platform>`

Show the detailed setup guide for the requested platform by reading the corresponding `references/<platform>.md` file.

---

## Notes

- Always mask secrets in output — show only last 4 characters
- Channel tools (reply, react, fetch_messages, etc.) appear in the bound agent automatically when a channel is enabled
- Each channel instance is identified by its `channel_provider` key (e.g., `"im_channels|discord"`, `"im_channels|discord_copy2"`)
- Multiple instances of the same platform are supported (e.g., two Discord bots for different servers)
- When Browser Control is available, prefer automation but always confirm with the user before clicking/filling sensitive fields
- Never store or log the full bot token — always mask it
