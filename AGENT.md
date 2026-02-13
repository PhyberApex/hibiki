# AGENT HANDOFF – Hibiki

## Repo TL;DR
- **Stack:** NestJS (apps/bot) + Vue 3 (apps/web) in a pnpm workspace (Node 22.12 via `.nvmrc`).
- **What it does:** Discord music bot + REST API + dashboard. Discord service and REST endpoints share the same permission service (`apps/bot/src/permissions`). Player state lives in-memory and is snapshotted to SQLite (`storage/data/hibiki.sqlite`).
- **Key commands:**
  - `pnpm install` (root) → installs all workspaces.
  - `pnpm dev` → bot (watch) + Vue dev server.
  - `pnpm build` → builds Vue, copies dist, compiles Nest.
  - `pnpm --filter @hibiki/bot test` / `pnpm run lint`.

## Local environment checklist
1. `nvm use` (reads `.nvmrc` → v22.12.0).
2. `corepack enable && pnpm install`.
3. Create `.env` (or export env vars):
   - `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, optional `DISCORD_GUILD_ID`.
   - `HIBIKI_PREFIX`, `HIBIKI_DB_PATH` (default `storage/data/hibiki.sqlite`).
   - Storage dirs live under `storage/` → mount that path as a volume in Docker.
4. Start dev servers with `pnpm dev` or run prod build via `pnpm build` + `pnpm --filter @hibiki/bot start:prod`.

## Current status snapshot
- **Persistence:** SQLite snapshots implemented; `PlayerService.getState()` merges live + persisted states and annotates `source` + `lastUpdated`.
- **New REST:** `GET /api/player/guilds` exposes guild/channel directory for the dashboard.
- **Dashboard UX:** Player cards show live vs snapshot badges and relative timestamps; control panel pulls guild/channel lists and has reload + toast messaging.
- **CI:** pnpm-based workflows (`checks`, `release-please`, `docker-release`) are in `.github/workflows`. Lint/test/build all green as of commit `d2aaa0a`.
- **Docs:** `apps/bot/README.md` documents setup + REST map; Dockerfile builds the bundle and expects `storage/` to be mounted for persistence.

## Backlog / things still to explore
1. **Queue awareness:** snapshots only record last track; no queued tracks or resume state. Consider storing queue metadata if resumed playback matters.
2. **Guild/channel metadata:** directory endpoint relies on cached Discord data; no caching/TTL yet. Could add periodic refresh + error feedback in UI.
3. **Dashboard polish:** add success/error toasts for player actions, and maybe show currently playing track art/upload previews.
4. **Testing:** add integration/e2e coverage (supertest) hitting `/api/player/*` with mocked guards, plus Discord service unit tests using discord.js mocks.
5. **Deployment docs:** mention sample docker-compose (bot + volume + env file). Currently only README snippet.

## How to resume later
- Pull `develop`, run `pnpm install`, copy `.env.sample` (not yet created) or reuse docs above.
- `pnpm dev` to iterate; `pnpm run lint` before committing (conventional commits, e.g. `feat: ...`).
- Outstanding work primarily sits in `apps/web` (UX polish) and `apps/bot/src/player/*` for richer queue logic.

Have fun, future me 👾
