# Hibiki — Bot + API

Hibiki is a NestJS + Discord.js service that powers a Discord music bot, REST API, and Vue dashboard.

## Architecture Overview

| Layer | What it does |
| --- | --- |
| Discord service | Boots a Discord.js client, enforces permissions on `join/leave/play/effect/stop`, and forwards commands to the player service. |
| REST API | Exposes `/api/player/*` and `/api/sounds/*` so the dashboard (and automations) can control the bot. |
| Permissions | **Allowlist** of Discord role IDs and/or user IDs, configurable from the **web UI** (Permissions). Stored in SQLite. Empty list = no one can use the bot. |
| Persistence | Player state lives in memory *and* is snapshotted into `storage/data/hibiki.sqlite` so dashboards show “last seen” status even after restarts. |
| Dashboard (Vue) | Lives in `apps/web` and talks to the REST endpoints (bundle copied into `apps/bot/web-dist` at build time). |

## Local Development

### Requirements

- Node.js 22.12.0 (`.nvmrc` is provided, run `nvm use`)
- pnpm 10.29.x (`corepack enable` to install)
- **ffmpeg** — required for decoding and playing audio. Install for your OS:
  - **macOS:** `brew install ffmpeg`
  - **Ubuntu/Debian:** `sudo apt install ffmpeg`
  - **Windows:** `choco install ffmpeg` or install from [ffmpeg.org](https://ffmpeg.org/download.html)

  If ffmpeg is missing, playback will fail with "FFmpeg/avconv not found!".

### One-time setup

```bash
# in repo root
corepack enable
pnpm install
```

### Environment variables

Copy `.env.sample` to `.env` at the workspace root (or use your shell env) with:

```bash
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID= (optional default guild)
HIBIKI_PREFIX=!
HIBIKI_DB_PATH=storage/data/hibiki.sqlite
HIBIKI_STORAGE_PATH=storage
# Optional: add other env vars as needed (dashboard/API have no built-in auth; restrict access yourself)
# HIBIKI_DASHBOARD_DEFAULT_ROLES=admin
```

The defaults keep everything inside `storage/` so Docker volumes can persist uploads + SQLite.

### Running locally

```bash
# dev mode (bot + Vue dev server)
pnpm dev
# Open the Vue dev server URL (e.g. http://localhost:5173); it proxies /api to the bot.

# build production assets (Vue → Nest)
pnpm build

# run compiled bot
pnpm --filter @hibiki/bot start:prod
```

### Tests & lint

```bash
pnpm --filter @hibiki/bot test
pnpm run lint
```

## Discord commands

All commands use the configurable prefix (default `!`). Who can use the bot is set in the web UI (see **Permissions** below).

| Command | Description |
| --- | --- |
| `!help` | List all commands. |
| `!delete` | Clear this channel's bot messages (last 100, under 14 days). |
| `!menu` / `!panel` | Post a **control panel** (buttons + dropdown) in the channel. The message stays until deleted; use it anytime for join/leave, stop, play music/effect, list songs/effects. |
| `!join` | Join your current voice channel. |
| `!leave` | Disconnect from the guild. |
| `!stop` | Stop playback. |
| `!songs` | List available music (name + id). |
| `!effects` | List available sound effects. |
| `!play <name or id>` | Play a song by name or id (e.g. `!play ambient` or `!play my-track-123`). |
| `!effect <name or id>` | Trigger an effect by name or id. |

Use `!songs` and `!effects` to see what’s available, then `!play` / `!effect` with the name or id. Prefer `!menu` for a guided in-Discord UI.

## REST API quick reference

- `GET /api/player/state` — live + snapshot player state.
- `GET /api/player/guilds` — guild + voice channel directory for the dashboard.
- `POST /api/player/{join,leave,stop,play,effect}` — mirrors Discord commands.
- `GET|POST|DELETE /api/sounds/{music|effects}` — list/upload/delete assets.

API routes are not protected by the bot; restrict dashboard/API access at your reverse proxy or network.

## Permissions (allowlist)

From the **web UI** → **Permissions**: add Discord **role IDs** and/or **user IDs** that are allowed to use the bot. Anyone with an allowed role, or whose user ID is in the list, can run any command. If both lists are empty, no one can use the bot.

Get IDs from Discord (Developer Mode → right‑click a role or user → Copy ID). Stored in SQLite; takes effect immediately.

## Persistence & volumes

- SQLite snapshots: `storage/data/hibiki.sqlite`
- Sound uploads: `storage/music`, `storage/effects`

When running in Docker, mount `./storage` to a volume so uploads + snapshots survive container restarts.

## Deploy with Docker

From the **repo root**:

1. Copy `.env.sample` to `.env` and set `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`.
2. Create a `storage` directory (or let Docker create it when the volume mounts):
   ```bash
   mkdir -p storage
   ```
3. Run with Docker Compose:
   ```bash
   docker compose up -d
   ```
   The dashboard and API are at `http://localhost:3000`. The `./storage` volume persists SQLite and uploaded sounds.

To run the pre-built image without Compose:

```bash
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/storage:/app/storage \
  --env-file .env \
  ghcr.io/phyberapex/hibiki:latest
```

## Release & CI

- Release automation: release-please (`.github/workflows/release-please.yml`)
- Docker builds: GitHub Actions push to GHCR on tagged releases
- CI: `.github/workflows/checks.yml` runs lint/test/build via pnpm

That's the gist! See `apps/web/README.md` for dashboard specifics or poke around the code under `apps/bot/src/*` for more details.
