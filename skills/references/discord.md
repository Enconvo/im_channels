# Discord Bot — Complete Setup Guide

This guide covers creating a Discord bot from scratch, obtaining the token, configuring intents, inviting it to a server, and connecting it to Enconvo.

## Quick Overview

```
Discord Developer Portal  →  Create Application  →  Add Bot  →  Copy Token
                           →  Enable Intents      →  Generate Invite URL  →  Add to Server
Enconvo                    →  Create Channel       →  Paste Token          →  Enable
```

---

## Step 1: Create a Discord Application

1. Open **https://discord.com/developers/applications** (log in if needed)
2. Click the **"New Application"** button (top-right)
3. Enter a name for your bot (e.g., "My Enconvo Bot") → click **"Create"**
4. You're now on the **General Information** page — optionally add a description and icon

### Browser Control automation

```
navigate → https://discord.com/developers/applications
click → "New Application" button
fill → application name field
click → "Create" button
```

## Step 2: Create the Bot User

1. In the left sidebar, click **"Bot"**
2. The bot user is created automatically with your application
3. Optionally customize the bot's username and avatar

## Step 3: Enable Required Intents

Still on the **Bot** page, scroll down to **Privileged Gateway Intents**:

1. Toggle ON: **Message Content Intent** (required — without this the bot cannot read message text)
2. Toggle ON: **Server Members Intent** (optional — enables member list access)
3. Click **"Save Changes"** if prompted

### Browser Control automation

```
click → "Bot" in sidebar
scroll → to "Privileged Gateway Intents" section
toggle → "Message Content Intent" ON
toggle → "Server Members Intent" ON (optional)
click → "Save Changes"
```

## Step 4: Copy the Bot Token

1. On the **Bot** page, find the **Token** section
2. Click **"Reset Token"** (or **"Copy"** if shown)
3. Confirm the reset if prompted
4. **Copy the token immediately** — it is shown only once
5. Keep this token secret — anyone with it can control your bot

### Browser Control automation

```
click → "Reset Token" button
click → confirm in dialog
click → "Copy" button next to the revealed token
```

## Step 5: Generate the Invite URL

1. In the left sidebar, click **"OAuth2"**
2. Scroll down to **"OAuth2 URL Generator"**
3. Under **Scopes**, check: `bot`
4. Under **Bot Permissions**, check at minimum:
   - `Send Messages`
   - `Read Message History`
   - `View Channels`
   - `Add Reactions` (for emoji reactions)
   - `Attach Files` (for sending files/images)
   - `Embed Links` (for URL embeds)
5. Copy the **Generated URL** at the bottom

### Browser Control automation

```
click → "OAuth2" in sidebar
scroll → to "OAuth2 URL Generator"
check → "bot" under Scopes
check → "Send Messages", "Read Message History", "View Channels", "Add Reactions", "Attach Files", "Embed Links"
copy → the generated URL
```

## Step 6: Invite the Bot to Your Server

1. Open the generated URL in your browser
2. Select the server you want to add the bot to
3. Click **"Authorize"**
4. Complete the captcha if prompted

### Browser Control automation

```
navigate → the generated invite URL
select → target server from dropdown
click → "Authorize" button
```

## Step 7: Connect to Enconvo

### Option A: Via Enconvo Settings UI

1. Open Enconvo → Settings → IM Channels
2. Select the Discord channel (or click "Add New Channel" → Discord)
3. Paste the **Bot Token** in the token field
4. Optionally set a **Default Channel ID** (see below)
5. Select a **Bound Agent** (the AI agent that will respond to messages)
6. Toggle **Enabled** to ON

### Option B: Via API

```
# Create a new Discord channel instance
local_api im_channels/create_channel {"platform": "discord"}

# Launch with token
local_api im_channels/launch_channel {
  "channel_provider": "im_channels|discord",
  "botToken": "YOUR_BOT_TOKEN"
}
```

---

## Finding Channel IDs

1. In Discord app, go to **Settings → Advanced → enable Developer Mode**
2. Right-click any channel → **"Copy Channel ID"**

The channel ID is a numeric string like `1234567890123456789`.

## Token Validation

```bash
curl -s -H "Authorization: Bot YOUR_TOKEN" https://discord.com/api/v10/users/@me
```

**Expected:** HTTP 200 with `"username"` field.
**HTTP 401** means invalid token — reset it in the Developer Portal.

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Bot doesn't respond to messages | Message Content Intent not enabled | Enable it in Bot → Privileged Gateway Intents |
| Bot can't see channels | Missing View Channels permission | Re-invite with correct permissions |
| "Invalid token" error | Token was reset or copied incorrectly | Reset token in Developer Portal, copy again |
| Bot appears offline | Channel not enabled in Enconvo | Toggle Enabled ON in IM Channels settings |
| Triple replies | Multiple connections to same bot | Stop all, then launch once |
