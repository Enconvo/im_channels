---
name: im_channels
description: >
  IM channel integration for Telegram and Discord. Each channel is essentially a bot on the IM platform that can interact with an Enconvo agent — when a message arrives, the bind agent automatically processes and replies. One agent can serve multiple channels, but each channel is bound to exactly one agent.
metadata:
  author: ysnows
  version: "0.0.28"
---

# IM Channels — Setup & Management

You are helping the user set up IM channel integrations for Enconvo. Supported platforms: **Discord** and **Telegram**.

The skill directory (SKILL_DIR) is wherever this SKILL.md lives. Find it via: `**/im_channels/skills/SKILL.md`

## Platform Reference Files

Detailed setup guides with step-by-step instructions live in `references/`:

| File | Content |
|------|---------|
| `references/discord.md` | Discord bot creation, token, intents, invite URL, channel IDs, validation, Browser Control steps |
| `references/telegram.md` | Telegram BotFather setup (manual + automated via BotFather CLI), Browser Control for API credentials, chat IDs, validation |

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
3. Paste bot token, select a bind agent, toggle Enabled
4. The bind agent automatically gets reply/react/fetch tools injected

## Configuring IM Channel Providers via Config API

Each channel's credentials and settings can also be configured programmatically via the `config/set` API (from the `config` module).

**Available IM channel providers:**

| Provider | Command Key | Required Credential |
|----------|-------------|-------------------|
| Discord | `im_channels\|discord` | `botToken` — Bot Token from Discord Developer Portal |
| Telegram | `im_channels\|telegram` | `botToken` — Bot API Token from @BotFather |

**1. Set bot token for a provider:**

```json
POST config/set
{ "preferenceKey": "im_channels|discord", "keys": ["botToken"], "value": "your-discord-bot-token" }
```

```json
POST config/set
{ "preferenceKey": "im_channels|telegram", "keys": ["botToken"], "value": "123456:ABC-DEF..." }
```

**2. Enable the channel listener (so it receives incoming messages):**

```json
POST config/set
{ "preferenceKey": "im_channels|telegram", "keys": ["enabled"], "value": true }
```

**3. Bind an agent to a channel (incoming messages go to this agent):**

```json
POST config/set
{ "preferenceKey": "im_channels|discord", "keys": ["bound_agent"], "value": "agent|main" }
```

Each provider's preferences:
- `botToken` (password, required) — the platform bot token
- `enabled` (checkbox) — enable/disable the real-time message listener
- `bound_agent` (dropdown) — which Enconvo agent handles incoming messages
- `access` (access_control) — who can use the bot (see Access Control below)

**Creating a new channel with all settings in one call:**

Use `im_channels/create_channel` to duplicate a base provider and set credentials + binding in one step:

```json
POST im_channels/create_channel
{
  "platform": "telegram",
  "title": "Sensei English Bot",
  "botToken": "123456:ABC-DEF...",
  "enabled": true,
  "bound_agent": "agent|main"
}
```

This creates a new channel command (e.g. `im_channels|telegram_2`), sets the bot token, enables the listener, and binds it to the specified agent — all at once.

## Access Control (Pairing System)

Each channel has an `access` preference that controls who can interact with the bot.

**Policies:**
- `pairing` (default) — unauthorized users receive an 8-character pairing code; the bot owner must approve before they can use the agent
- `open` — everyone can use the bot with no restrictions

**Pairing flow:**
1. User sends any message to the bot
2. Bot replies with a pairing code and instructions:
   ```
   Enconvo: access not configured.
   Your Telegram user id: 123456
   Pairing code: FSK7L2MA
   Ask the bot owner to approve with:
   enconvo im_channels pairing approve --channel telegram --code FSK7L2MA
   ```
3. Admin approves via one of:
   - **API**: `local_api im_channels/pairing/approve {"channel": "telegram", "code": "FSK7L2MA"}`
   - **Settings UI**: Enconvo Settings > channel > Access Control > Approve button
4. User can now interact with the bot normally

**Managing access via API:**

Set the access policy:
```json
POST config/set
{ "preferenceKey": "im_channels|telegram", "keys": ["access"], "value": { "policy": "open", "allowList": [], "pending": [] } }
```

Approve a pending pairing:
```json
POST im_channels/pairing/approve
{ "channel": "telegram", "code": "FSK7L2MA" }
```

The `channel` parameter is the short name from `im_channels/all_channels` (e.g. `telegram`, `discord`).

## API Reference

Just use the `local_api` tool to request these APIs.

| Endpoint | Description |
|----------|-------------|
| `im_channels/all_channels` | List all available IM channel providers. _No params_ |
| `im_channels/check_connection` | Check if a channel's credentials are valid by calling the platform API. Params: `channel_provider` (string, required) |
| `im_channels/configured_channels` | Returns all IM channel provider commands with configured status, enabled state, bind agent, and launch status. _No params_ |
| `im_channels/create_channel` | Create a new channel by duplicating the base provider command for a platform. _5 params — use `check_local_api_schemas` tool_ |
| `im_channels/launch_channel` | Launch a channel listener for a provider, reading config from preferences or using credential overrides. _4 params — use `check_local_api_schemas` tool_ |
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
| `im_channels/pairing/access` | Get access control configuration for a channel. Params: `channel` (string, required) |
| `im_channels/pairing/approve` | Approve a pending pairing request to grant a user access to the bot. Params: `channel` (string, required), `code` (string, required) |
| `im_channels/pairing/deny` | Deny a pending pairing request — removes it from the pending list. Params: `channel` (string, required), `code` (string, required) |
| `im_channels/telegram_actions/bot_api` | Call any Telegram Bot API method directly. The bot token is injected automatically — you only need to specify the method name and its parameters. This is a generic passthrough to the Telegram Bot API. Use it for any method not covered by the dedicated tools (reply, edit_message, react). File upload: any value that is a local file path (starting with "/") or a URL (http/https) inside params — at any nesting depth — will be automatically downloaded and uploaded via multipart/form-data using Telegram's `attach://` syntax. This works for top-level fields and nested InputFile fields (e.g. InputProfilePhoto). Max file size: 50 MB (Telegram Bot API limit). You can also use `local_api enconvo/upload_file {"filePath": "/path/to/file"}` to upload a file first and get a hosted URL. Common methods: - `getMe` — get bot info (username, id, etc.) - `setMyProfilePhoto` — set bot's own profile photo. Params: `{"photo": {"type": "static", "photo": "/path/to/image.png"}}` or `{"photo": {"type": "static", "photo": "https://..."}}` - `deleteMyProfilePhoto` — remove bot's profile photo - `setMyName` — change bot display name. Params: `{"name": "New Name"}` - `setMyDescription` — change bot description. Params: `{"description": "text"}` - `setMyShortDescription` — change bot short description shown in profile - `setChatPhoto` — set group chat photo (bot must be admin). Params: `{"chat_id": "...", "photo": "/path/to/photo.png"}` - `deleteChatPhoto` — remove group chat photo - `getChat` — get chat details. Params: `{"chat_id": "..."}` - `getChatMemberCount` — count members. Params: `{"chat_id": "..."}` - `getChatMember` — get a specific member's info. Params: `{"chat_id": "...", "user_id": 123}` - `banChatMember` / `unbanChatMember` — moderation - `pinChatMessage` / `unpinChatMessage` — pin/unpin messages - `setMyCommands` — set bot command menu. Params: `{"commands": [{"command": "start", "description": "Start the bot"}]}` - `deleteMyCommands` — remove bot command menu - `getMyCommands` — list current bot commands - `setChatMenuButton` — set bot menu button - `sendSticker` — send a sticker. Params: `{"chat_id": "...", "sticker": "/path/to/sticker.webp"}` - `createNewStickerSet` / `addStickerToSet` — sticker set management - `getCustomEmojiStickers` — get custom emoji stickers by IDs - `setMessageReaction` — react to a message (also available as dedicated `react` tool) - `forwardMessage` — forward a message. Params: `{"chat_id": "...", "from_chat_id": "...", "message_id": 123}` - `copyMessage` — copy a message without "forwarded" label - `exportChatInviteLink` — generate invite link for a group - `setChatTitle` / `setChatDescription` — change group title/description - `leaveChat` — make the bot leave a chat Full reference: https://core.telegram.org/bots/api. Params: `channel_provider` (string, required), `method` (string, required), `params` (object) |
| `im_channels/telegram_actions/edit_message` | Edit a message the bot previously sent in Telegram. _4 params — use `check_local_api_schemas` tool_ |
| `im_channels/telegram_actions/react` | Add an emoji reaction to a Telegram message by ID. _4 params — use `check_local_api_schemas` tool_ |
| `im_channels/telegram_actions/reply` | Send a message to a Telegram chat with optional file attachments and threading. _5 params — use `check_local_api_schemas` tool_ |


## Browser Control Integration

Before guiding manual steps, check if Browser Control is ready. Use `browser_control/status` to verify — it returns connection state directly.

- **If connected:** Browser Control is available. Proceed with automation.
- **If unavailable:** The user needs to install the **Enconvo Companion** Chrome extension. Offer to help them install it, or fall back to manual steps.

Available Browser Control tools:

| Tool | Purpose |
|------|---------|
| `browser_control/status` | Check if Browser Control is connected |
| `browser_control/navigate` | Open a URL |
| `browser_control/snapshot` | **Use before every interaction** — returns page DOM tree with element refs for click/fill targeting |
| `browser_control/click` | Click an element (use ref from snapshot) |
| `browser_control/fill` | Fill a text field (use ref from snapshot) |
| `browser_control/get_text` | Read text from page |
| `browser_control/screenshot` | Take a visual screenshot |
| `browser_control/wait_for` | Wait for element to appear |

**Pattern:** Always call `snapshot` first to get the DOM tree → find element refs → then `click`/`fill` using those refs. Use `screenshot` as a visual aid to verify page state or show the user what's on screen.

## BotFather CLI (Telegram Bot Management)

The BotFather CLI (`SKILL_DIR/scripts/botfather.py`) automates Telegram bot management via the Telethon user client. It sends messages to @BotFather as the authenticated user and parses responses.

**Prerequisites:** Telegram API credentials (`api_id` + `api_hash`) and an authenticated Telethon session. See the setup flow in `create telegram` or `references/telegram.md`.

**Quick Reference:**

| Want to... | Command |
|---|---|
| Check auth status | `botfather.py status` |
| List all bots | `botfather.py list` |
| Create a bot | `botfather.py create "Display Name" "username_bot"` |
| Delete a bot | `botfather.py delete @mybot` |
| Get bot token | `botfather.py token @mybot` |
| Revoke bot token | `botfather.py token @mybot --revoke` |
| Set bot name | `botfather.py set name @mybot "New Name"` |
| Set bot description | `botfather.py set description @mybot "New description"` |
| Set bot about | `botfather.py set about @mybot "About text"` |
| Set bot commands | `botfather.py set commands @mybot "cmd1 - Desc 1\ncmd2 - Desc 2"` |
| Set bot photo | `botfather.py set userpic @mybot /path/to/photo.jpg` |
| Toggle inline mode | `botfather.py set inline @mybot "Enable"` or `"Disable"` |
| Toggle group joining | `botfather.py set joingroups @mybot "Enable"` or `"Disable"` |
| Toggle privacy | `botfather.py set privacy @mybot "Enable"` or `"Disable"` |
| Get bot info | `botfather.py info @mybot` |
| Send raw command | `botfather.py send "/mybots"` |

All commands support `--json` for machine-readable output.

**Full path:** `SKILL_DIR/scripts/botfather.py`

**File layout:**
```
SKILL_DIR/scripts/
  botfather.py              # Python CLI (Telethon + argparse)

~/.botfather/
  config.json               # api_id, api_hash
  session.session            # Telethon session (auto-created)
```

Run via Bash tool: `python3 SKILL_DIR/scripts/botfather.py <subcommand> [args]`
(Enconvo handles the venv and `telethon` dependency — no shell wrapper needed.)

**Important notes:**
- Telethon auth is always interactive — needs terminal input for phone + 2FA code. Cannot be automated.
- Browser Control only automates getting API credentials from my.telegram.org — Telethon auth still needs terminal.
- Bot usernames in commands should include the `@` prefix (e.g., `@mybot`).
- Token output is sensitive — always mask in user-facing output.

---

## Subcommands

### `create <platform>`

**This is the primary workflow when a user says "create a Discord/Telegram bot".**

The goal is to walk the user through creating a new bot on the platform AND connecting it to Enconvo — end to end.

#### Step 1 — Create the bot on the platform

Read the relevant `references/<platform>.md` file for the full workflow.

**Telegram — use BotFather CLI (preferred):**

Always prefer the BotFather CLI. It creates bots, gets tokens, and configures settings fully automatically.

**Step T1 — Check BotFather CLI status:**

Run `python3 SKILL_DIR/scripts/botfather.py status`

- **If authenticated:** Skip to Step T3 (create the bot).
- **If not configured:** Proceed to Step T2 (one-time setup).

**Step T2 — BotFather CLI Setup (one-time):**

The CLI needs Telegram API credentials (`api_id` + `api_hash`) from https://my.telegram.org.

Check `browser_control/status` to decide how to obtain them:

- **Browser Control available →** automate credential retrieval (always `snapshot` before interacting):
  1. `browser_control/navigate` → `https://my.telegram.org/auth`
  2. `browser_control/snapshot` + `browser_control/screenshot` — inspect login page, show user
  3. Tell the user: "Please enter your phone number and complete login. Let me know when done."
  4. Once user confirms login, **proceed automatically** — no further prompts:
  5. `browser_control/snapshot` — verify login, identify page elements
  6. `browser_control/click` → "API development tools" link (use ref from snapshot)
  7. `browser_control/snapshot` — check if app exists or needs creation
  8. If no app: automatically create — `browser_control/fill` fields (title: `BotFather CLI`, short name: `botfather_cli`, platform: `Desktop`) → `browser_control/click` "Create application"
  9. `browser_control/snapshot` → verify creation succeeded and extract `api_id` and `api_hash`
  10. **If creation fails:** Tell the user to create the app manually at https://my.telegram.org, then provide `api_id` and `api_hash`
  11. `browser_control/screenshot` — show user the result
  11. Save creds: `python3 SKILL_DIR/scripts/botfather.py save-creds --api-id <ID> --api-hash <HASH> --skip-auth`
  12. Run Telethon auth (interactive terminal — user must type phone + code): `python3 SKILL_DIR/scripts/botfather.py auth`

- **Browser Control unavailable →** tell the user they can install the **Enconvo Companion** Chrome extension for automated setup, or proceed manually:
  Run `python3 SKILL_DIR/scripts/botfather.py setup` (interactive — guides the user through visiting my.telegram.org and typing credentials)

**After setup, the CLI persists the session** — no re-auth needed for future bot operations.

**Step T3 — Create the bot:**

```bash
python3 SKILL_DIR/scripts/botfather.py create "Bot Display Name" "bot_username_bot" --json
```

**Step T4 — Get the token:**

```bash
python3 SKILL_DIR/scripts/botfather.py token @bot_username_bot --json
```

Parse the token from the JSON output.

**Discord:**

Check `browser_control/status` first.

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

#### Step 2 — Create the channel in Enconvo

Once the user has the bot token:

1. Call `local_api im_channels/create_channel {"platform": "<discord|telegram>"}` to create a new channel instance
2. Tell the user to open **Enconvo Settings > IM Channels**
3. They should see the new channel — paste the bot token there
4. Select a bind agent
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

The bind agent should respond automatically.

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
> Your channel is configured! The bind agent will now respond to messages from this channel automatically. Send a test message to verify everything works.

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
- Channel tools (reply, react, fetch_messages, etc.) appear in the bind agent automatically when a channel is enabled
- Each channel instance is identified by its `channel_provider` key (e.g., `"im_channels|discord"`, `"im_channels|discord_copy2"`)
- Multiple instances of the same platform are supported (e.g., two Discord bots for different servers)
- When Browser Control is available, prefer automation but always confirm with the user before clicking/filling sensitive fields
- Never store or log the full bot token — always mask it
