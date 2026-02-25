# Hibiki — App

The `@hibiki/app` package contains the full Hibiki application: an **Electron** desktop app with a Discord audio bot backend and a Vue 3 frontend.

## Architecture

| Layer | What it does |
|-------|-------------|
| **Electron main process** | Boots the backend, creates the app window, handles IPC, manages `WebContentsView` instances for the built-in browser, serves sound files via the `hibiki://` custom protocol. |
| **Backend** (`src/`) | Discord.js client (join/leave/play/stop), player (voice connections, audio mixing, volume), sound library (file management), scene store (soundboards), app config (persistence). Runs inside the Electron main process — no HTTP server. |
| **Frontend** (`frontend/`) | Vue 3 + Pinia + Vue Router, rendered in Electron. Views: Welcome, Scenes, Browser, Media Management, Settings. Communicates with the backend exclusively via Electron IPC. |
| **Persistence** | App config and scenes stored as JSON files. Sound files stored on disk. Data directory is the platform's user data path (e.g. `~/Library/Application Support/hibiki` on macOS). |

**Multi-guild:** The bot can be in multiple servers at once — one voice channel per server. Each guild has its own playback state and volume.

## Project structure

```text
app/
├── electron/          # Electron main process (main.js, preload.js)
├── frontend/          # Vue 3 + Vite (renderer process)
│   └── src/
│       ├── api/       # IPC wrappers (player, sounds, scenes, config, browser-view)
│       ├── audio/     # Web Audio capture (AudioWorklet-based)
│       ├── stores/    # Pinia stores (player state, guild directory)
│       └── views/     # Pages (WelcomeView, SceneView, BrowserView, MediaManagementView, SettingsView)
├── src/               # Backend TypeScript
│   ├── bootstrap-embedded.ts  # Wires up all services, exposes the IPC API
│   ├── config/        # Environment and app configuration
│   ├── discord/       # Discord.js client (login, voice, guild directory)
│   ├── player/        # Playback engine (voice connections, streams, volume)
│   ├── sound/         # Sound library (list, upload, delete files)
│   ├── scenes/        # Scene store, import/export
│   └── persistence.ts # Key-value JSON file store (app-config.json)
├── web-dist/          # Built frontend (vite build output)
└── dist/              # Compiled TypeScript (tsc output)
```

## Local development

### Requirements

- Node.js 20 or 22 (see [.nvmrc](../.nvmrc); run `nvm use`)
- pnpm (`corepack enable`)

### Run

From the **repo root**:

```bash
pnpm dev
```

This compiles the backend (TypeScript), builds the frontend (Vite), and launches the Electron app window.

### Build only (no launch)

```bash
pnpm build
```

Produces `app/dist/` (backend) and `app/web-dist/` (frontend) without starting Electron.

## Scripts (app-level)

These are defined in `app/package.json` and can be run with `pnpm --filter @hibiki/app run <script>`. From the repo root, the main ones are exposed as top-level scripts (see root README).

| Script | What it does |
|--------|-------------|
| `dev` | Build backend + frontend, then launch Electron |
| `build` | Build frontend (Vite) + compile backend (tsc) |
| `build:frontend` | Build only the Vue frontend |
| `dist` | Build + package the app for the current platform (electron-builder) |
| `dist:mac` | Package for macOS (`.dmg` + `.zip`) |
| `dist:win` | Package for Windows (`.exe` NSIS installer) |
| `dist:linux` | Package for Linux (`.AppImage` + `.deb`) |
| `lint` | Run ESLint on backend and frontend |
| `test` | Run backend (Jest) + frontend (Vitest) tests in parallel |
| `test:backend` | Jest tests only |
| `test:frontend` | Vitest tests only |
| `test:watch` | Jest in watch mode (backend) |
| `test:coverage` | Run both test suites with coverage |

## Storage

- **Config & scenes:** `app-config.json`, `scenes.json` in the data directory.
- **Sounds:** `music/`, `effects/`, `ambience/` directories.

When running as the Electron app, data lives in the platform's user data directory. Override with `HIBIKI_STORAGE_PATH` or other env vars (see [.env.example](../.env.example)).
