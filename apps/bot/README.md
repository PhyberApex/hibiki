# Hibiki — Bot + API

Hibiki is a NestJS + Discord.js service that powers a Discord music bot, REST API, and Vue dashboard.

## Architecture Overview

| Layer | What it does |
| --- | --- |
| Discord service | Boots a Discord.js client, enforces permissions on `join/leave/play/effect/stop`, and forwards commands to the player service. |
| REST API | Exposes `/api/player/*` and `/api/sounds/*` so the dashboard (and automations) can control the bot. |
| Permissions | `apps/bot/src/permissions` loads `permission-config.json` into an injectable service + guard shared by Discord and REST. |
| Persistence | Player state lives in memory *and* is snapshotted into `storage/data/hibiki.sqlite` so dashboards show “last seen” status even after restarts. |
| Dashboard (Vue) | Lives in `apps/web` and talks to the REST endpoints (bundle copied into `apps/bot/web-dist` at build time). |

## Local Development

### Requirements

- Node.js 22.12.0 (`.nvmrc` is provided, run `nvm use`)
- pnpm 10.29.x (`corepack enable` to install)
- ffmpeg installed locally (required for audio playback)

### One-time setup

```bash
# in repo root
corepack enable
pnpm install
```

### Environment variables

Create `.env` at the workspace root (or use your shell env) with:

```bash
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_GUILD_ID= (optional default guild)
HIBIKI_PREFIX=!
HIBIKI_DB_PATH=storage/data/hibiki.sqlite
HIBIKI_STORAGE_PATH=storage
```

The defaults keep everything inside `storage/` so Docker volumes can persist uploads + SQLite.

### Running locally

```bash
# dev mode (bot + Vue dev server)
pnpm dev

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

## REST API quick reference

- `GET /api/player/state` — live + snapshot player state.
- `GET /api/player/guilds` — guild + voice channel directory for the dashboard.
- `POST /api/player/{join,leave,stop,play,effect}` — mirrors Discord commands.
- `GET|POST|DELETE /api/sounds/{music|effects}` — list/upload/delete assets.

All routes are protected by the permission guard (roles defined in `permission-config.json`).

## Permissions config

`apps/bot/src/permissions/permission-config.json` maps Discord role IDs + dashboard emails to roles (`admin`, `moderator`, `dj`). Each role grants a set of command keys. Update the JSON and redeploy to change access.

## Persistence & volumes

- SQLite snapshots: `storage/data/hibiki.sqlite`
- Sound uploads: `storage/music`, `storage/effects`

When running in Docker, mount `./storage` to a volume so uploads + snapshots survive container restarts:

```bash
docker run \
  -v $(pwd)/storage:/app/storage \
  ghcr.io/phyberapex/hibiki:latest
```

## Release & CI

- Release automation: release-please (`.github/workflows/release-please.yml`)
- Docker builds: GitHub Actions push to GHCR on tagged releases
- CI: `.github/workflows/checks.yml` runs lint/test/build via pnpm

That's the gist! See `apps/web/README.md` for dashboard specifics or poke around the code under `apps/bot/src/*` for more details.
