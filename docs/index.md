---
layout: default
title: Home
---

## What is Hibiki?

**Hibiki** (響) is a Discord bot for music and sound effects in voice channels. It’s built mainly for **Dungeons & Dragons**—background music, ambience, and sound effects at the table—but you can use it for any Discord server that needs voice-channel audio: streaming, community hangouts, or other games.

Control it from Discord with commands (`!join`, `!play`, `!effect`, `!volume`) or the **control panel** (`!menu`), or from the **web dashboard**: join/leave, play tracks, trigger effects, adjust volume, upload and manage sounds, and see bot status at a glance. One Docker image; SQLite is used only for player snapshots and the permissions allowlist. Sound files live on disk.

## Features

<div class="features">
<div class="feature"><h3>Web dashboard</h3>
<p>Set the mood at the table: player state, join/leave, play music or effects, volume sliders (music and effects per server), upload and manage sounds. Bot connection status and permissions in one place.</p></div>
<div class="feature"><h3>Discord commands</h3>
<p><code>!join</code>, <code>!leave</code>, <code>!play</code>, <code>!effect</code>, <code>!volume</code>, <code>!menu</code> for a button panel. List songs and effects, then play by name or id. Volume dropdowns right in the panel.</p></div>
<div class="feature"><h3>One container</h3>
<p>Single Docker image. Mount a volume for storage; SQLite and uploaded sounds persist. Works for D&D night or 24/7 community servers.</p></div>
</div>

## Discord bot setup

You need a Discord application and bot token before running Hibiki. Follow these steps once.

1. **Create an application** — Go to [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**. Name it (e.g. Hibiki) and create. On **General Information**, copy the **Application ID**; this is `DISCORD_CLIENT_ID`.
2. **Create the bot and get the token** — In the sidebar, open **Bot** → **Add Bot**. Under **Token**, click **Reset Token** (or View Token), then copy it. This is `DISCORD_TOKEN`; keep it secret. Under **Privileged Gateway Intents**, turn on **Message Content Intent** (required for commands).
3. **Invite the bot to your server** — Open **OAuth2** → **URL Generator**. Under **Scopes** choose **bot**. Under **Bot Permissions** select: **View Channels**, **Send Messages**, **Read Message History**; for voice enable **Connect** and **Speak**; and **Move Members** (required so the bot can leave voice channels, e.g. from the dashboard or after a restart). Optionally **Manage Messages** (for `!delete`). Copy the generated URL, open it in a browser, pick your server, and authorize. The bot will show up in your server (offline until Hibiki is running).
4. **Set environment variables** — In the repo root, copy the sample env and add the values you copied:

{: .steps}

```bash
cp .env.exmaple .env
# Edit .env and set:
# DISCORD_TOKEN=your_bot_token
# DISCORD_CLIENT_ID=your_application_id
```

**Bot profile picture (optional)** — If you want the bot to use the Hibiki logo in Discord, use the **logo.png** from the repo. In the [Discord Developer Portal](https://discord.com/developers/applications), open your application → **Bot** → **Profile Image**, then upload `logo.png` from the project root (or from the `docs/` folder). Discord will use it as the bot’s avatar everywhere it appears.

## Run Hibiki

After the Discord bot is set up, install dependencies and start the bot and dashboard.

**Requirements:** Node.js 20+, pnpm (`corepack enable`), and ffmpeg.

```bash
git clone https://github.com/phyberapex/hibiki.git
cd hibiki
corepack enable && pnpm install
cp .env.exmaple .env   # set DISCORD_TOKEN and DISCORD_CLIENT_ID
pnpm dev
```

- **Dashboard:** [http://localhost:5173](http://localhost:5173) (dev). Check the “Bot connected” indicator; use the Control Center to join a voice channel, play, and adjust **volume** (music and effects sliders per server). Discord: `!join`, `!play`, `!menu`, `!volume music 80`, etc. Who can use the bot is set in the dashboard under **Permissions** (allowlist of role/user IDs).
- **Docker:** `docker compose up -d` (after setting `.env`). Dashboard and API at [http://localhost:3000](http://localhost:3000). Pre-built images: `ghcr.io/phyberapex/hibiki:latest` (releases) or `ghcr.io/phyberapex/hibiki:next` (bleeding edge). See the main repo README for all tags.

[View on GitHub](https://github.com/phyberapex/hibiki){: .cta}

## Volume control

Music and effects volume are set **per server** (per guild):

- **Dashboard:** When the bot is connected to a server, the Playback controls show **Music volume** and **Effects volume** sliders. Change them and the new volume applies to the next track or effect (and to already-playing music when you change music volume for future playback).
- **Discord:** Use `!volume` to see current levels, or `!volume music 80` / `!volume effects 90` to set them. The control panel (`!menu`) has **Music volume** and **Effects volume** dropdowns (0%, 25%, 50%, 75%, 100%).

## If text commands do nothing (!menu, !play, etc.)

The bot must have **Message Content Intent** enabled or it cannot read your messages. In the [Discord Developer Portal](https://discord.com/developers/applications) → your application → **Bot** → **Privileged Gateway Intents**, turn **Message Content Intent** **ON**, then save. Restart Hibiki after changing. If it’s already on, check the **Permissions** allowlist in the dashboard — your Discord user or role must be allowed to use the bot.

## E2E tests (real Discord)

The repo includes an **E2E test suite** that talks to a running Hibiki instance and a real Discord server: it joins a voice channel via the API, plays a track and an effect, then leaves, and checks that the bot’s state and (optionally) Discord’s voice state match.

- **Setup:** Copy `.env.e2e.example` to `.env.e2e` and set `E2E_HIBIKI_API_URL` (default `http://localhost:3000`), `E2E_GUILD_ID`, and `E2E_VOICE_CHANNEL_ID`. Optionally set `E2E_TEXT_CHANNEL_ID` and `E2E_SIDECAR_TOKEN` (a second bot in the same server). The sidecar verifies voice state and runs command tests when Hibiki allows it. Results are in the CLI; no Discord notifications. **Sidecar bot permissions:** View Channels, Send Messages, Read Message History; for voice tests also Connect and Speak.
- **Run:** Start Hibiki, then from the repo root run `pnpm run test:e2e`. If the E2E env vars are not set, the Discord-dependent tests are skipped.

## About this project

This project was created in large part with **AI-assisted coding tools**. We encourage human review, testing, and contributions.

## Known issues

- **Playback crackling at start** — The first second or so of a track (or effect) can sometimes crackle or pop. This is a known limitation of the current audio pipeline and may be improved in a future release.
