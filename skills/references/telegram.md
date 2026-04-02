# Telegram Bot — Complete Setup Guide

This guide covers creating a Telegram bot via @BotFather, obtaining the token, and connecting it to Enconvo.

## Quick Overview

```
Telegram App  →  Message @BotFather  →  /newbot  →  Copy Token
Enconvo       →  Create Channel      →  Paste Token  →  Enable
```

---

## Step 1: Create the Bot via @BotFather

1. Open Telegram and search for `@BotFather` (verified blue checkmark)
2. Send `/newbot` to start the creation flow
3. Choose a **display name** for your bot (e.g., "My Enconvo Bot")
4. Choose a **username** — must end in `bot` (e.g., `my_enconvo_bot`)
5. BotFather replies with a token like: `7823456789:AAF-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
6. **Copy the full token** — this is your bot token

## Step 2: Configure Bot Settings (Optional)

Send these commands to @BotFather:

- `/setprivacy` → choose your bot → `Disable` — allows bot to see all messages in groups (not just /commands)
- `/setdescription` → set a description shown when users first open a chat with the bot
- `/setabouttext` → set the bio shown in the bot's profile

## Step 3: Connect to Enconvo

### Option A: Via Enconvo Settings UI

1. Open Enconvo → Settings → IM Channels
2. Select the Telegram channel (or click "Add New Channel" → Telegram)
3. Paste the **Bot Token** in the token field
4. Optionally set a **Default Chat ID** (see below)
5. Select a **Bound Agent** (the AI agent that will respond to messages)
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
