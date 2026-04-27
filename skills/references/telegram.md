# Telegram Bot — Complete Setup Guide

This guide covers creating a Telegram bot via @BotFather, obtaining the token, and connecting it to Enconvo.

## Quick Overview

There are two ways to create a Telegram bot:

| Method | What happens | When to use |
|--------|-------------|-------------|
| **BotFather CLI (automated)** | CLI talks to @BotFather via Telethon, creates bot + gets token automatically | Preferred — fully automated after one-time setup |
| **Manual** | User messages @BotFather in Telegram app | Fallback if user doesn't want CLI setup |

---

## Automated: BotFather CLI

The BotFather CLI (`SKILL_DIR/scripts/botfather.py`) automates bot creation by sending messages to @BotFather as the authenticated user.

### One-Time Setup

The CLI needs Telegram API credentials (`api_id` + `api_hash`). There are two ways to obtain them:

#### Browser Control Automation (recommended)

Check if Browser Control is ready via `browser-use/status`. If unavailable, prompt the user to install the **Enconvo Companion** Chrome extension first.

If available, automate the my.telegram.org workflow.

**Pattern:** Use `browser-use/snapshot` before every interaction — it returns the page DOM tree with element references you can target for `click` and `fill`. Use `browser-use/screenshot` as a visual aid to verify page state or show the user what's happening. Always snapshot first to get refs, then act.

1. `browser-use/navigate` → `https://my.telegram.org/auth`
2. `browser-use/snapshot` + `browser-use/screenshot` — inspect login page, show user the page
3. Ask the user to enter their phone number and complete login. Wait for confirmation.
4. Once user confirms login, **proceed automatically** — no further prompts needed:
5. `browser-use/snapshot` — verify login succeeded, identify page elements
6. `browser-use/click` → click **"API development tools"** link (use ref from snapshot)
7. `browser-use/snapshot` — inspect the page:
   - **App already exists:** `api_id` and `api_hash` are visible in the DOM → extract values directly
   - **No app yet:** Automatically create it:
     - `browser-use/fill` → App title: `BotFather CLI` (use ref from snapshot)
     - `browser-use/fill` → Short name: `botfather_cli`
     - Platform: `Desktop`
     - `browser-use/click` → "Create application"
     - `browser-use/snapshot` → verify creation succeeded and extract `api_id` and `api_hash`
     - **If creation fails:** Tell the user to create the app manually at https://my.telegram.org, then provide `api_id` and `api_hash`. Fall back to manual setup below.
8. `browser-use/screenshot` — show user the result for confirmation
9. Save credentials:
   ```bash
   SKILL_DIR/scripts/botfather.py save-creds --api-id <ID> --api-hash <HASH> --skip-auth
   ```
8. Run Telethon auth (interactive — user must type phone + code in terminal):
   ```bash
   SKILL_DIR/scripts/botfather.py auth
   ```

#### Manual Setup

```bash
SKILL_DIR/scripts/botfather.py setup
```

This interactively guides the user to visit https://my.telegram.org, copy credentials, and authenticate.

### Creating a Bot (after setup)

```bash
# Create the bot
SKILL_DIR/scripts/botfather.py create "My Enconvo Bot" "my_enconvo_bot" --json

# Get the token
SKILL_DIR/scripts/botfather.py token @my_enconvo_bot --json
```

### Configuring Bot Settings

```bash
# Disable privacy (allow bot to see all group messages)
SKILL_DIR/scripts/botfather.py set privacy @my_enconvo_bot "Disable"

# Set description
SKILL_DIR/scripts/botfather.py set description @my_enconvo_bot "Powered by Enconvo AI"

# Set about text
SKILL_DIR/scripts/botfather.py set about @my_enconvo_bot "AI assistant bot"
```

---

## Manual: @BotFather in Telegram App

### Step 1: Create the Bot

1. Open Telegram and search for `@BotFather` (verified blue checkmark)
2. Send `/newbot` to start the creation flow
3. Choose a **display name** for your bot (e.g., "My Enconvo Bot")
4. Choose a **username** — must end in `bot` (e.g., `my_enconvo_bot`)
5. BotFather replies with a token like: `7823456789:AAF-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
6. **Copy the full token** — this is your bot token

### Step 2: Configure Bot Settings (Optional)

Send these commands to @BotFather:

- `/setprivacy` → choose your bot → `Disable` — allows bot to see all messages in groups (not just /commands)
- `/setdescription` → set a description shown when users first open a chat with the bot
- `/setabouttext` → set the bio shown in the bot's profile

## Connect to Enconvo (both methods)

### Option A: Via Enconvo Settings UI

1. Open Enconvo → Settings → IM Channels
2. Select the Telegram channel (or click "Add New Channel" → Telegram)
3. Paste the **Bot Token** in the token field
4. Optionally set a **Default Chat ID** (see below)
5. Select a **bind agent** (the AI agent that will respond to messages)
6. Toggle **Enabled** to ON

### Option B: Via API

```
# Create a new Telegram channel instance
local_api im_channels/create_channel {"platform": "telegram"}

# Launch with token
local_api im_channels/launch_channel {
  "channel_provider": "im_channels|telegram",
  "botToken": "YOUR_BOT_TOKEN"
}
```

---

## Finding Chat IDs

1. Start a chat with your bot (search for its username, click **Start**)
2. Send any message (e.g., "hello")
3. Open in browser: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
4. Find `"chat":{"id":123456789,...}` — that number is the Chat ID
5. For groups, the Chat ID is negative (e.g., `-1001234567890`)

## Token Validation

```bash
curl -s "https://api.telegram.org/botYOUR_TOKEN/getMe"
```

**Expected:** `"ok":true` with bot username.
**If not:** Re-check the token from @BotFather. You can use `/token` to get a new one.

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Bot doesn't respond in groups | Privacy mode enabled | Send `/setprivacy` → Disable to @BotFather |
| Bot doesn't respond at all | Channel not enabled | Toggle Enabled ON in IM Channels settings |
| "Unauthorized" error | Token invalid or revoked | Get new token via `/token` command to @BotFather |
| Can't find Chat ID | No messages sent yet | Send a message to the bot first, then check getUpdates |
