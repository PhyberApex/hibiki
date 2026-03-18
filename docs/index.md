---
layout: default
title: Home
---

## What is Hibiki?

**Hibiki** (響) is a Discord audio companion — play music, ambience, and sound effects in voice channels from a desktop app. Built for **Dungeons & Dragons** (background music, ambient soundscapes, one-shot effects at the table) but works for any Discord server that needs voice-channel audio.

Everything is controlled from the **Electron desktop app**: join/leave voice channels, build scenes (soundboards), stream browser audio, manage your sound library, and adjust volume — all without any Discord slash or prefix commands.

## Features

<div class="features">
<div class="feature"><h3>Scenes</h3>
<p>Build soundboards with music tracks, ambience loops (with random interval repeats), and one-shot effects. Play an entire scene or individual tracks. Export and import scenes as zip files. <a href="{{ site.baseurl }}/scene-sharing">Share scenes</a> with the community or install scenes from a public registry.</p></div>
<div class="feature"><h3>Browser streaming</h3>
<p>Open any URL (YouTube, Spotify web, etc.) in the built-in browser tab and stream its audio directly to Discord. Bookmark your favourite sites for quick access.</p></div>
<div class="feature"><h3>Media library</h3>
<p>Upload and manage sound files (music, effects, ambience). Sounds are stored on disk and available across all scenes.</p></div>
<div class="feature"><h3>Desktop app</h3>
<p>Runs as an Electron app. The Discord bot backend runs in the main process; data (config, sounds, scenes) lives in the platform's user data directory.</p></div>
</div>

## Discord bot setup

You need a Discord application and bot token before running Hibiki. Follow these steps once.

1. **Create an application and bot** — Go to [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**. Name it (e.g. Hibiki) and create. In the sidebar, open **Bot** → **Add Bot**. Under **Token**, click **Reset Token** (or View Token), then copy it. Keep it secret; set it in the app **Settings** or as `DISCORD_TOKEN` in `.env`.
2. **Invite the bot to your server** — Open **OAuth2** → **URL Generator**. Under **Scopes** choose **bot**. Under **Bot Permissions** select: **View Channels**, **Connect**, **Speak**, **Move Members**. Copy the generated URL, open it in a browser, pick your server, and authorize. The bot will show up in your server (offline until Hibiki is running).
3. **(Optional) Environment variables** — For development, copy the sample env and set the token:

{: .steps}

```bash
cp .env.example .env
# Edit .env and set DISCORD_TOKEN=your_bot_token
```

## Download

Pre-built binaries for **macOS**, **Windows**, and **Linux** are available on the [Releases](https://github.com/PhyberApex/hibiki/releases) page.

> **macOS note:** The app is not code-signed. Remove the quarantine flag after downloading: `xattr -cr /Applications/Hibiki.app`

## Run from source

**Requirements:** Node.js 20 or 22, pnpm (`corepack enable`). No ffmpeg required.

```bash
git clone https://github.com/phyberapex/hibiki.git
cd hibiki
corepack enable && pnpm install
cp .env.example .env   # optional: set DISCORD_TOKEN (or set in Settings after starting)
pnpm dev
```

This builds everything and launches the Electron app. Set the Discord token in **Settings** if you haven't set `DISCORD_TOKEN`, then use the sidebar to join a voice channel and start playing.

[View on GitHub](https://github.com/phyberapex/hibiki){: .cta}

## Known issues

- **Playback crackling at start** — The first second or so of a track can sometimes crackle or pop. This is a known limitation of the current audio pipeline and may be improved in a future release.
