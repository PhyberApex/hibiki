# Step-by-step plan: Hibiki → Electron app

> **Note:** This is historical documentation describing the migration plan from a Docker-based monorepo to an Electron app. The actual implementation superseded the planned "Phase 2" (creating an `app/` workspace package) and went directly to a fully flattened structure with all code at root level (`src/`, `frontend/`, `electron/`). See the current structure in [README.md](../README.md).

This document outlines the migration from a Dockerized backend + frontend (mono-repo) to a single Electron app that runs both the Discord bot and the web UI, with an eye toward future "stream from browser" audio (Kenku FM–style).

**Reference:** [Kenku FM](https://github.com/owlbear-rodeo/kenku-fm) — Electron app that shares tabletop audio to Discord; uses main process (Discord, HTTP server, browser views), renderer (React), and preload bridge. Audio from web content is captured via Electron’s APIs and sent to Discord.

---

## Goals

- **Single Electron app:** one process (or main + renderer) runs both the bot and the web UI.
- **No Docker:** remove Dockerfile, docker-compose, and Docker-based CI.
- **Flatten mono-repo:** single app package; e2e can stay as a sibling package or be in-repo tests.
- **Remove permission system:** app-only control; no slash/prefix commands and no permission management.
- **Token in UI:** configure Discord bot token from the app UI (stored securely by the app).
- **Future-ready:** architecture should allow later adding “browse websites in Electron and stream that audio to the bot” (not implemented in this migration).

---

## Phase 1: Simplify the backend (remove commands and permissions)

Do this while still in the current repo layout so you can run lint/tests after each step.

### 1.1 Remove permission system

- **Bot**
  - Delete or gut `apps/bot/src/permissions/` (permission-config.service, permissions.controller, permissions.module, permission-config.json, types, index).
  - Remove `PermissionsModule` from `DiscordModule` and any `PermissionConfigService` usage (e.g. in `DiscordService`: `isAllowed` checks and constructor).
  - In `DiscordService`, remove all permission checks in `handleMessage` and `handleInteraction` (or remove those code paths entirely in a later step when you remove commands).

- **Web**
  - Remove permissions UI and API usage:
    - Delete `apps/web/src/views/PermissionsView.vue` and `PermissionsView.spec.ts`.
    - Delete `apps/web/src/api/permissions.ts` and `permissions.test.ts`.
  - Remove the `/permissions` route from `apps/web/src/router/index.ts`.
  - Remove permissions nav/link from `App.vue` (and any other references to permissions).
  - Update `App.spec.ts` and any other tests that mock or reference permissions.

- **Config**
  - Remove permission-related env (e.g. `HIBIKI_ALLOWED_DISCORD_USER_IDS`) from `apps/bot/src/config/configuration.ts` and `validation.ts`.

### 1.2 Remove slash and prefix commands

- **Slash commands**
  - In `DiscordService`: remove `registerSlashCommands()` and the call to it in `ClientReady`.
  - Remove slash handler and REST usage: `DiscordSlashHandler`, `getSlashCommandsJSON`, `discord-slash.commands.ts`, `discord-slash.handler.ts` (and their specs).
  - Remove `discord.clientId` / `DISCORD_CLIENT_ID` from configuration and validation if they were only used for slash registration.

- **Prefix commands**
  - In `DiscordService`: remove `messageCreate` listener and `handleMessage` (and the prefix config).
  - Remove `DiscordCommandHandler` and `discord-commands.handler.ts` (and spec).
  - Remove `commandPrefix` and `e2eAllowBotId` from configuration and validation.

- **Interactions (optional for “app only”)**
  - If you want zero Discord UI: remove `interactionCreate` listener and `handleInteraction`; remove `DiscordInteractionHandler`, `discord-interactions.handler.ts`, and panel builder (and specs). Bot is then driven only by the web UI (HTTP API).
  - If you want to keep in-Discord buttons/select menus for the transition, you can leave interactions for a later cleanup.

- **E2E**
  - E2E currently uses the sidecar to send prefix commands. After removing prefix/slash, E2E should drive the bot only via the HTTP API (join, play, etc.). Update `e2e/sidecar.discord.e2e.spec.ts` and `e2e/tests/web.e2e.spec.ts` to use only the API (and optionally keep the sidecar only for “see bot in voice channel” checks).

### 1.3 Bot token from config / UI (backend support)

- **Option A – Env only for now**
  - Keep reading token from `DISCORD_TOKEN` in configuration. Add a later step to switch to UI-provided token.

- **Option B – DB-backed token (recommended for Electron)**
  - Use existing `AppConfigService` to store something like `discord.token` (and optionally `discord.clientId` if you still need it).
  - Add an API only the renderer will call (or later, Electron main): e.g. `GET /api/config/discord` and `PUT /api/config/discord` with `{ token?, clientId? }`. Backend reads token from `AppConfigService` first, then falls back to env.
  - In `configuration.ts`, load discord token from `AppConfigService` if available (Nest async config or a small bootstrap that reads DB before creating the app). Alternatively, start Nest without Discord, then after first “set token” from UI, write to DB and trigger Discord login (may require refactor so `DiscordService` can login when token is set, not only at startup).
  - For Electron, you’ll later replace or wrap this with secure storage (e.g. `safeStorage` or keychain) and expose “set token” via IPC instead of HTTP if desired.

- **Validation**
  - Change validation so `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` are optional (token can come from DB/UI).

---

## Phase 2: Flatten repo and drop Docker

### 2.1 Mono-repo → single app package

- **Option A – Single root package**
  - Move `apps/bot` and `apps/web` contents into the repo root (or into `src/main`, `src/renderer`, `src/web-ui`, etc.). Single `package.json` at root; one `pnpm install` and one build.
  - Pros: one place for deps, simpler scripts. Cons: bigger single package, need to separate main vs renderer build (Electron will need this anyway).

- **Option B – Keep “app” as one workspace package (recommended)**
  - Replace `apps/bot` and `apps/web` with a single workspace package, e.g. `app/`, that contains:
    - `app/package.json` (all bot + web deps, Electron deps added later).
    - `app/src/main/` (current Nest + Discord bot code).
    - `app/src/web/` or `app/frontend/` (current Vue app).
  - Root `package.json` workspaces: `["app", "e2e"]`. Scripts: `pnpm --filter app build`, etc.
  - Copy/build step: build the web UI into a dir that the “backend” serves (e.g. `app/dist/web` or `app/web-dist`), same as today’s `copy-web-dist.cjs` but inside `app/`.

- **E2E**
  - **Keep e2e as its own package:** `e2e/` stays in workspaces; it depends on “the app” running (started manually or by CI). No need for e2e to depend on `app` as a workspace dependency unless you want to start the app from e2e scripts. So: keep `e2e` as a separate package for clarity and to run Playwright/vitest against the running app.
  - Update root scripts: `test:e2e` runs `pnpm --filter e2e test:playwright` (and optionally `test` for vitest). E2E base URL can stay `http://localhost:3000` or point to Electron’s dev server if you expose the API there.

### 2.2 Remove Docker

- Delete `Dockerfile` and `docker-compose.yml`.
- Remove or rewrite Docker-based CI in `.github/workflows/docker-release.yml` and `docker-next.yml` (e.g. replace with “build Electron” or “build Node app” for now).
- Update README: remove Docker run instructions; add “run with pnpm” and later “run Electron app”.

### 2.3 Turbo / scripts

- If you keep two workspaces (`app`, `e2e`): keep `turbo.json` and root scripts; point `build`/`dev` to the `app` package.
- If you fully flatten to one root package: remove Turbo and use a single root `package.json` with scripts that build the one app and run e2e from `e2e/`.

---

## Phase 3: Introduce Electron

### 3.1 Add Electron and split main vs renderer

- Add Electron (and e.g. Electron Forge or electron-builder) to the app package.
  - **Main process:** runs Node; will host the Nest app (or the same logic in a plain Node script) and the Discord bot. No DOM.
  - **Renderer process:** the existing Vue app; loads in a BrowserWindow (or BrowserView). Use the same Vue build; in dev, point the renderer to Vite dev server or to the built static files.
- **Kenku FM–style layout (reference):**
  - `main` process: Discord connection, HTTP server for “remote control”, creation of windows and browser views.
  - `renderer`: UI (they use React; you keep Vue).
  - `preload`: bridge that exposes safe APIs from main to renderer (e.g. “get bot status”, “join channel”, “set token”).

### 3.2 Run Nest (or equivalent) inside Electron main

- **Option A – Nest inside main**
  - Start Nest in the Electron main process (same process as the Discord bot). Nest’s Express listens on a port (e.g. 3000) or a Unix socket. Renderer and e2e call `http://localhost:3000/api/...` in dev; in production you might keep the same or use a custom protocol (e.g. `hibiki://api/...`) that main handles.
  - Ensure storage paths (DB, music, effects) are under app user data (e.g. `app.getPath('userData')`) so they persist and are writable.

- **Option B – No HTTP, only IPC**
  - Expose all “API” via Electron IPC: renderer uses `invoke('api', { path, method, body })` and main calls the same Nest controllers or services internally. No CORS, no port. E2E would need to run against a “test mode” that exposes HTTP, or run Playwright against the Electron app and drive the UI (no direct API calls).

- **Recommendation:** Keep the HTTP API in main (Nest or Express) for Phase 3 so e2e and dev experience stay simple; you can move to IPC-only later if desired.

### 3.3 Token configuration in the UI

- Add a “Settings” or “Bot” page in the Vue app: field for Discord bot token (and optionally client id), Save button.
- If using HTTP API: `PUT /api/config/discord` with token; backend stores in `AppConfigService` (or, in Electron, main can store in `safeStorage` and pass to the bot).
- If using IPC: renderer calls `invoke('setDiscordToken', token)`; main stores and (re)starts or updates the Discord client.
- **Security:** In Electron, never expose the raw token to the renderer after save; only “saved” / “error” and maybe “connected as …”. Store token only in main (DB or safeStorage).

### 3.4 Window and build

- Main window: load the Vue app (file:// or http:// in dev).
- Packaged app: build Vue to a folder; Electron loads it from `file://` or from a custom protocol. Ensure API base URL in the frontend points to the same backend (e.g. relative `/api` if the same origin, or a fixed `http://127.0.0.1:3000` if backend is on a port).
- Build/pack: use Forge or electron-builder to produce OS-specific installers; include Node, Nest, and web assets.

### 3.5 Storage and paths

- Use `app.getPath('userData')` (and optionally `app.getPath('documents')`) for:
  - JSON config and scenes (`app-config.json`, `scenes.json`),
  - `storage/music`, `storage/effects`,
  - any config that you don’t put in Electron’s safeStorage.
- Update `configuration.ts` (or equivalent) to read these paths from env set by main (e.g. `process.env.HIBIKI_USER_DATA` set by main before starting Nest).

---

## Phase 4: E2E and cleanup

### 4.1 E2E against Electron or HTTP

- **Option A – E2E against HTTP API only**
  - Start the Electron app in “headless” or “test” mode (e.g. env `E2E=1` so it listens on 3000 and doesn’t show a window). E2E stays as today: hit `http://localhost:3000/api/...` and use Playwright for the web UI at `http://localhost:3000/`.
  - E2E package stays; no need to be a separate “product” package, just a test suite that expects the app to be running.

- **Option B – E2E launches Electron**
  - Use Playwright’s Electron support to launch the app and drive the UI (and optionally still call HTTP for setup). More realistic but more complex.

- **Recommendation:** Start with Option A (run app in test mode, same URLs as today). Keep e2e as a separate package; CI runs `app` in test mode then runs `pnpm --filter e2e test:playwright`.

### 4.2 Remove obsolete code and docs

- Remove any remaining references to Docker, permissions, slash commands, prefix commands, and env-only token from README and docs.
- Update `docs/index.md` and any architecture docs to describe the Electron app (main + renderer, token in UI, no Discord commands).

---

## Phase 5 (future): “Stream from website” audio

- **Not part of this migration.** When you do it:
  - Use **BrowserView** (or similar) in Electron to open websites (e.g. YouTube, Spotify). Capture audio from that view (e.g. `contents.capturePage()` or desktopCapturer / getDisplayMedia, or Electron’s built-in audio capture if available).
  - Mix or replace the current file-based playback with this stream and send it to the Discord voice connection (same way Kenku FM does with Eris + captured audio).
  - Current audio pipeline (e.g. `audio-engine`, `guild-audio.manager`, prism-media, node-audio-mixer) may need to accept “live stream” inputs in addition to files.

---

## Summary checklist

| Area | Action |
|------|--------|
| Permissions | Remove permissions module, controller, service; remove from DiscordService; remove PermissionsView and permissions API from web; remove route and nav. |
| Commands | Remove slash registration and handlers; remove prefix message handler and command handler; optionally remove interactions. |
| Token | Make token configurable from UI; store in AppConfig or Electron safeStorage; make env token optional. |
| Repo | Collapse to one app package (`app/`) + e2e package; remove Docker and Docker CI. |
| Electron | Add Electron; main runs Nest + Discord; renderer is Vue; preload bridge; token set via UI; paths in userData. |
| E2E | Keep e2e package; run against HTTP (app in test mode) or Electron; no prefix/slash, API-only. |
| Audio (later) | Design for future “browser view → capture → Discord” without changing this migration. |

---

## Suggested order of execution

1. **Phase 1.1** – Remove permissions (bot + web).
2. **Phase 1.2** – Remove slash and prefix commands; adjust E2E to use only API.
3. **Phase 1.3** – Add token-from-UI (API + AppConfig or equivalent).
4. **Phase 2** – Flatten to `app` + `e2e`, remove Docker.
5. **Phase 3** – Add Electron shell, run Nest in main, Vue in renderer, token in UI, paths in userData.
6. **Phase 4** – E2E and docs cleanup.

Each step should leave the project in a runnable state with lint and tests passing where applicable.
