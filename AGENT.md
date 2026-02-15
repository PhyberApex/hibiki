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
3. **Dashboard polish (done):** success/error toasts for player actions added; track/effect selection is now dropdowns (music + effects lists). Optional: show currently playing track art/upload previews.
4. **Testing:** add integration/e2e coverage (supertest) hitting `/api/player/*` with mocked guards, plus Discord service unit tests using discord.js mocks.
5. **Deployment docs (done):** `.env.sample` created; `docker-compose.yml` added; bot README documents “Deploy with Docker” with compose and `docker run` examples.

## Original prompt checklist (from user)

- **Name:** Japanese-inspired ✓ (Hibiki)
- **Web UI:** TypeScript + Vue ✓
- **Backend:** TypeScript + NestJS ✓
- **Single Docker container** ✓ (Dockerfile + docker-compose)
- **Releases:** release-please + Docker on release (workflows on `main`; if you use `develop` as default, either merge to `main` for releases or change workflow branches)
- **Discord bot** ✓ (!join, !leave, !stop, !play, !effect, !songs, !effects)
- **Web UI:** See where bot is running + manage uploaded sounds ✓
- **Discord-only control** ✓ (text commands; !songs/!effects list tracks; !play/!effect accept name or id)
- **Two sound types** ✓ (music = background; effects = mixed in via audio-mixer)

Gaps addressed in this pass: dashboard API auth (set `HIBIKI_DASHBOARD_DEFAULT_ROLES=admin` so UI works without login), Vite proxy for dev, Discord !songs/!effects and play-by-name.

## How to resume later
- Pull `develop`, run `pnpm install`, copy `.env.sample` to `.env` and set Discord vars. Set `HIBIKI_DASHBOARD_DEFAULT_ROLES=admin` so the dashboard can call the API.
- `pnpm dev` to iterate (Vite proxies `/api` to the bot); `pnpm run lint` before committing (conventional commits, e.g. `feat: ...`).
- Outstanding work: queue/resume in `apps/bot/src/player/*` and `apps/bot/src/audio/*`, plus integration/e2e tests.

Have fun, future me 👾
