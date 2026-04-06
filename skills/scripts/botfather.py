#!/usr/bin/env python3
"""BotFather CLI — interact with @BotFather via Telethon user client."""

import argparse
import asyncio
import json
import os
import sys
import time

CONFIG_DIR = os.path.expanduser("~/.botfather")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")
SESSION_FILE = os.path.join(CONFIG_DIR, "session")

BOTFATHER_USERNAME = "BotFather"


def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return {}


def save_config(cfg):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, indent=2)


def ensure_config():
    cfg = load_config()
    if not cfg.get("api_id") or not cfg.get("api_hash"):
        print("ERROR: Not configured. Run: botfather setup", file=sys.stderr)
        sys.exit(1)
    return cfg


def get_client(cfg):
    from telethon import TelegramClient
    return TelegramClient(SESSION_FILE, int(cfg["api_id"]), cfg["api_hash"])


async def send_and_wait(client, command, wait_sec=3, max_wait=15):
    """Send a message to BotFather and wait for response(s)."""
    entity = await client.get_entity(BOTFATHER_USERNAME)

    # Get current message count to know what's new
    before = await client.get_messages(entity, limit=1)
    before_id = before[0].id if before else 0

    # Send our message
    await client.send_message(entity, command)

    # Wait for response
    elapsed = 0
    while elapsed < max_wait:
        await asyncio.sleep(wait_sec)
        elapsed += wait_sec
        msgs = await client.get_messages(entity, limit=5)
        # Find new messages from BotFather (not from us)
        new_msgs = []
        for m in msgs:
            if m.id > before_id and m.sender_id != (await client.get_me()).id:
                new_msgs.append(m)
        if new_msgs:
            return new_msgs

    return []


async def click_button(client, message, button_text):
    """Click an inline keyboard button by its text."""
    if not has_inline_buttons(message):
        return None

    for row in message.reply_markup.rows:
        for button in row.buttons:
            if button.text.strip() == button_text.strip() or button_text.strip() in button.text.strip():
                result = await message.click(data=button.data)
                # Wait for updated message or new message
                await asyncio.sleep(2)
                entity = await client.get_entity(BOTFATHER_USERNAME)
                msgs = await client.get_messages(entity, limit=3)
                new_msgs = [m for m in msgs if m.sender_id != (await client.get_me()).id]
                return new_msgs

    return None


def has_inline_buttons(msg):
    """Check if message has inline keyboard buttons (not ReplyKeyboardHide etc)."""
    return msg.reply_markup and hasattr(msg.reply_markup, 'rows')


def format_response(messages):
    """Format BotFather response messages for output."""
    parts = []
    for msg in messages:
        text = msg.text or ""
        parts.append(text)

        if has_inline_buttons(msg):
            buttons = []
            for row in msg.reply_markup.rows:
                for btn in row.buttons:
                    buttons.append(btn.text)
            if buttons:
                parts.append("Buttons: " + " | ".join(buttons))

    return "\n---\n".join(parts)


def format_json(messages):
    """Format response as JSON."""
    results = []
    for msg in messages:
        entry = {"text": msg.text or "", "id": msg.id}
        if has_inline_buttons(msg):
            buttons = []
            for row in msg.reply_markup.rows:
                for btn in row.buttons:
                    buttons.append(btn.text)
            entry["buttons"] = buttons
        results.append(entry)
    return json.dumps(results, indent=2, ensure_ascii=False)


# ── Command handlers ──


async def cmd_setup(args):
    """Interactive setup: get API credentials and authenticate."""
    cfg = load_config()

    print("=== BotFather CLI Setup ===\n")
    print("You need Telegram API credentials (api_id + api_hash).\n")
    print("Steps to get them:")
    print("  1. Go to https://my.telegram.org")
    print("  2. Log in with your phone number")
    print("  3. Click 'API development tools'")
    print("  4. Create an app (any name/short name/platform is fine)")
    print("  5. Copy the api_id (number) and api_hash (hex string)\n")

    api_id = input("Enter api_id: ").strip()
    api_hash = input("Enter api_hash: ").strip()

    if not api_id or not api_hash:
        print("ERROR: Both api_id and api_hash are required.", file=sys.stderr)
        sys.exit(1)

    cfg["api_id"] = api_id
    cfg["api_hash"] = api_hash
    save_config(cfg)

    print("\nCredentials saved. Now authenticating with Telegram...")

    client = get_client(cfg)
    await client.start()
    me = await client.get_me()
    print(f"\nAuthenticated as: {me.first_name} (@{me.username or 'no username'})")
    print(f"Phone: {me.phone}")
    print("\nSetup complete! You can now use botfather commands.")
    await client.disconnect()


async def cmd_save_creds(args):
    """Save API credentials (used by Playwright automation flow)."""
    if not args.api_id or not args.api_hash:
        print("ERROR: --api-id and --api-hash are required.", file=sys.stderr)
        sys.exit(1)

    cfg = load_config()
    cfg["api_id"] = args.api_id
    cfg["api_hash"] = args.api_hash
    save_config(cfg)
    print(f"Credentials saved to {CONFIG_FILE}")

    if not args.skip_auth:
        print("Now authenticating with Telegram...")
        client = get_client(cfg)
        await client.start()
        me = await client.get_me()
        print(f"Authenticated as: {me.first_name} (@{me.username or 'no username'})")
        print(f"Phone: {me.phone}")
        print("Setup complete!")
        await client.disconnect()
    else:
        print("Skipped Telethon auth (--skip-auth). Run 'botfather auth' to authenticate later.")


async def cmd_auth(args):
    """Authenticate Telethon session (interactive — needs phone + code)."""
    cfg = ensure_config()
    client = get_client(cfg)
    await client.start()
    me = await client.get_me()
    print(f"Authenticated as: {me.first_name} (@{me.username or 'no username'})")
    print(f"Phone: {me.phone}")
    await client.disconnect()


async def cmd_list(args):
    """List all your bots via /mybots."""
    cfg = ensure_config()
    client = get_client(cfg)
    async with client:
        msgs = await send_and_wait(client, "/mybots")
        if args.json:
            print(format_json(msgs))
        else:
            print(format_response(msgs))


async def cmd_create(args):
    """Create a new bot via /newbot."""
    cfg = ensure_config()
    client = get_client(cfg)
    async with client:
        # Step 1: Send /newbot
        msgs = await send_and_wait(client, "/newbot")
        print("BotFather:", msgs[0].text if msgs else "No response")

        # Step 2: Send display name
        msgs = await send_and_wait(client, args.name)
        print("BotFather:", msgs[0].text if msgs else "No response")

        # Step 3: Send username
        msgs = await send_and_wait(client, args.username)
        if args.json:
            print(format_json(msgs))
        else:
            print("BotFather:", format_response(msgs))


async def cmd_delete(args):
    """Delete a bot via /deletebot."""
    cfg = ensure_config()
    client = get_client(cfg)
    async with client:
        msgs = await send_and_wait(client, "/deletebot")
        if msgs and has_inline_buttons(msgs[0]):
            # Click the bot button
            result = await click_button(client, msgs[0], args.bot)
            if result:
                # Confirm with "Yes, I'm totally sure."
                confirm_msgs = await send_and_wait(client, "Yes, I'm totally sure.")
                if args.json:
                    print(format_json(confirm_msgs))
                else:
                    print(format_response(confirm_msgs))
            else:
                print(f"ERROR: Bot '{args.bot}' not found in button list", file=sys.stderr)
                print(format_response(msgs))
        else:
            print(format_response(msgs))


async def cmd_set(args):
    """Generic setter: /setname, /setdescription, /setabouttext, /setcommands."""
    COMMAND_MAP = {
        "name": "/setname",
        "description": "/setdescription",
        "about": "/setabouttext",
        "commands": "/setcommands",
        "inline": "/setinline",
        "joingroups": "/setjoingroups",
        "privacy": "/setprivacy",
        "userpic": "/setuserpic",
        "inline-feedback": "/setinlinefeedback",
    }

    cmd = COMMAND_MAP.get(args.setting)
    if not cmd:
        print(f"ERROR: Unknown setting '{args.setting}'", file=sys.stderr)
        print(f"Available: {', '.join(COMMAND_MAP.keys())}", file=sys.stderr)
        sys.exit(1)

    cfg = ensure_config()
    client = get_client(cfg)
    async with client:
        # Step 1: Send the command
        msgs = await send_and_wait(client, cmd)

        if not msgs:
            print("ERROR: No response from BotFather", file=sys.stderr)
            sys.exit(1)

        # Step 2: Select the bot (click button or send bot username)
        if has_inline_buttons(msgs[0]):
            result = await click_button(client, msgs[0], args.bot)
            if not result:
                print(f"ERROR: Bot '{args.bot}' not found", file=sys.stderr)
                print(format_response(msgs))
                sys.exit(1)
            msgs = result
        else:
            msgs = await send_and_wait(client, args.bot)

        # For toggle settings (inline, joingroups, privacy), we may need to click a button
        if args.setting in ("inline", "joingroups", "privacy", "inline-feedback"):
            if msgs and has_inline_buttons(msgs[0]) and args.value:
                result = await click_button(client, msgs[0], args.value)
                if result:
                    msgs = result
            if args.json:
                print(format_json(msgs))
            else:
                print(format_response(msgs))
            return

        # For userpic, we need to send a photo
        if args.setting == "userpic":
            if not args.value:
                print("ERROR: Provide path to image file as value", file=sys.stderr)
                sys.exit(1)
            entity = await client.get_entity(BOTFATHER_USERNAME)
            await client.send_file(entity, args.value)
            await asyncio.sleep(3)
            final = await client.get_messages(entity, limit=2)
            new = [m for m in final if m.sender_id != (await client.get_me()).id]
            if args.json:
                print(format_json(new))
            else:
                print(format_response(new))
            return

        # For text settings (name, description, about), send the value
        if not args.value:
            # If no value, user might want to clear (send "empty")
            print("Current state:")
            print(format_response(msgs))
            return

        # For commands, value should be multiline: "cmd1 - desc1\ncmd2 - desc2"
        msgs = await send_and_wait(client, args.value)
        if args.json:
            print(format_json(msgs))
        else:
            print(format_response(msgs))


async def cmd_token(args):
    """Get or revoke a bot token."""
    cfg = ensure_config()
    client = get_client(cfg)
    cmd = "/revoke" if args.revoke else "/token"

    async with client:
        msgs = await send_and_wait(client, cmd)
        if msgs and has_inline_buttons(msgs[0]):
            result = await click_button(client, msgs[0], args.bot)
            if result:
                if args.revoke:
                    # Confirm revocation
                    confirm = await click_button(client, result[0], "Revoke") if has_inline_buttons(result[0]) else result
                    if confirm:
                        result = confirm
                if args.json:
                    print(format_json(result))
                else:
                    print(format_response(result))
            else:
                print(f"ERROR: Bot '{args.bot}' not found", file=sys.stderr)
        else:
            print(format_response(msgs))


async def cmd_send(args):
    """Send raw command to BotFather and print response."""
    cfg = ensure_config()
    client = get_client(cfg)
    async with client:
        msgs = await send_and_wait(client, args.command, max_wait=args.timeout)

        # If there's a follow-up message to send
        if args.follow_up and msgs:
            if args.click and has_inline_buttons(msgs[0]):
                result = await click_button(client, msgs[0], args.follow_up)
                if result:
                    msgs = result
            else:
                msgs = await send_and_wait(client, args.follow_up)

        if args.json:
            print(format_json(msgs))
        else:
            print(format_response(msgs))


async def cmd_bot_info(args):
    """Get info about a specific bot via /mybots -> select bot."""
    cfg = ensure_config()
    client = get_client(cfg)
    async with client:
        msgs = await send_and_wait(client, "/mybots")
        if msgs and has_inline_buttons(msgs[0]):
            result = await click_button(client, msgs[0], args.bot)
            if result:
                if args.json:
                    print(format_json(result))
                else:
                    print(format_response(result))
            else:
                print(f"ERROR: Bot '{args.bot}' not found", file=sys.stderr)
                print(format_response(msgs))
        else:
            print(format_response(msgs))


async def cmd_status(args):
    """Check if authenticated and show current user."""
    cfg = load_config()
    if not cfg.get("api_id"):
        print("Not configured. Run: botfather setup")
        return

    client = get_client(cfg)
    try:
        async with client:
            me = await client.get_me()
            print(f"Authenticated: {me.first_name} (@{me.username or 'none'})")
            print(f"Phone: {me.phone}")
            print(f"Config: {CONFIG_FILE}")
            print(f"Session: {SESSION_FILE}.session")
    except Exception as e:
        print(f"Auth error: {e}")
        print("Try: botfather setup")


def main():
    parser = argparse.ArgumentParser(prog="botfather", description="Interact with @BotFather via Telegram user API")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    sub = parser.add_subparsers(dest="cmd")

    # setup
    sub.add_parser("setup", help="Configure API credentials and authenticate (interactive)")

    # save-creds (for Playwright automation flow)
    p_save = sub.add_parser("save-creds", help="Save API credentials (non-interactive, for automation)")
    p_save.add_argument("--api-id", required=True, help="Telegram API ID")
    p_save.add_argument("--api-hash", required=True, help="Telegram API hash")
    p_save.add_argument("--skip-auth", action="store_true", help="Skip Telethon auth (do it later with 'auth')")

    # auth
    sub.add_parser("auth", help="Authenticate Telethon session (interactive)")

    # status
    sub.add_parser("status", help="Check auth status")

    # list
    sub.add_parser("list", help="List all your bots")

    # create
    p_create = sub.add_parser("create", help="Create a new bot")
    p_create.add_argument("name", help="Display name for the bot")
    p_create.add_argument("username", help="Bot username (must end in 'bot')")

    # delete
    p_delete = sub.add_parser("delete", help="Delete a bot")
    p_delete.add_argument("bot", help="Bot username (e.g. @mybot)")

    # set
    p_set = sub.add_parser("set", help="Change bot settings")
    p_set.add_argument("setting", help="Setting to change: name, description, about, commands, inline, joingroups, privacy, userpic, inline-feedback")
    p_set.add_argument("bot", help="Bot username (e.g. @mybot)")
    p_set.add_argument("value", nargs="?", default=None, help="New value (text, or 'Enable'/'Disable' for toggles, or file path for userpic)")

    # token
    p_token = sub.add_parser("token", help="Get or revoke bot token")
    p_token.add_argument("bot", help="Bot username")
    p_token.add_argument("--revoke", action="store_true", help="Revoke and regenerate token")

    # info
    p_info = sub.add_parser("info", help="Get info about a bot")
    p_info.add_argument("bot", help="Bot username")

    # send (raw)
    p_send = sub.add_parser("send", help="Send raw command to BotFather")
    p_send.add_argument("command", help="Command to send (e.g. /mybots)")
    p_send.add_argument("--follow-up", help="Follow-up message or button text to send")
    p_send.add_argument("--click", action="store_true", help="Click button instead of sending text for follow-up")
    p_send.add_argument("--timeout", type=int, default=15, help="Max wait seconds (default 15)")

    args = parser.parse_args()

    if not args.cmd:
        parser.print_help()
        sys.exit(1)

    handler = {
        "setup": cmd_setup,
        "save-creds": cmd_save_creds,
        "auth": cmd_auth,
        "status": cmd_status,
        "list": cmd_list,
        "create": cmd_create,
        "delete": cmd_delete,
        "set": cmd_set,
        "token": cmd_token,
        "info": cmd_bot_info,
        "send": cmd_send,
    }[args.cmd]

    asyncio.run(handler(args))


if __name__ == "__main__":
    main()
