# Hibiki (響)

![GitHub License](https://img.shields.io/github/license/phyberapex/hibiki)
[![GitHub Release](https://img.shields.io/github/v/release/phyberapex/hibiki)](https://github.com/PhyberApex/hibiki/releases)
[![codecov](https://codecov.io/gh/PhyberApex/hibiki/graph/badge.svg?token=XAZJ3X18SE)](https://codecov.io/gh/PhyberApex/hibiki)
[![GitHub Repo stars](https://img.shields.io/github/stars/phyberapex/hibiki?style=social)](https://github.com/PhyberApex/hibiki/stargazers)

![Hibiki](logo.png)

**Desktop audio companion for Discord** — play music, ambience, and sound effects in voice channels from an Electron app. Built with **Dungeons & Dragons** in mind (background music, ambient soundscapes, one-shot effects at the table) but works for any server.

- **Scenes** — Build soundboards with music tracks, ambience loops (with random interval repeats), and one-shot effects. Play an entire scene or individual tracks.
- **Browser** — Open any URL (YouTube, Spotify web, etc.) in a built-in browser tab and stream its audio to Discord. Bookmark your favourite sites.
- **Media library** — Upload and manage your own sound files (music, effects, ambience). Import/export scenes as portable bundles.
- **App-only control** — The bot has no slash or prefix commands; everything is driven from the desktop UI.

## Stack

| Part        | Tech                             |
|-------------|----------------------------------|
| Desktop app | Electron (main + renderer)       |
| Backend     | Node.js, Discord.js, TypeScript  |
| Frontend    | Vue 3, Pinia, Vue Router, Vite   |
| Audio       | discord.js voice, Web Audio API (AudioWorklet) |
| Persistence | JSON files (config, scenes, sounds on disk) |

## Requirements

- **Node.js** 20 or 22 (see [.nvmrc](.nvmrc)). Use `nvm use` to activate.
  The voice stack uses `@discordjs/opus`, which ships prebuilds only for these versions.
- **pnpm** — `corepack enable && pnpm install`
- **No ffmpeg** — audio processing uses the browser's Web Audio API.

## Setting up a Discord bot

Before running Hibiki you need a Discord bot token.

### 1. Create an application and bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application**, name it (e.g. "Hibiki"), and create it.
3. Go to **Bot** → **Add Bot** and confirm.
4. Under **Token**, click **Reset Token** (or **View Token**), then **Copy**.
   Store it securely — you can set it in the app's **Settings** page or via the `DISCORD_TOKEN` env var.

### 2. Invite the bot to your server

1. Go to **OAuth2** → **URL Generator**.
2. Under **Scopes**, select **bot**.
3. Under **Bot Permissions**, select at least:
   **View Channels**, **Connect**, **Speak**, **Move Members**.
4. Copy the **Generated URL**, open it in a browser, choose your server, and authorize.

The bot will appear in your server's member list (offline until Hibiki is running).

## Download

Pre-built binaries for **macOS**, **Windows**, and **Linux** are available on the [Releases](https://github.com/PhyberApex/hibiki/releases) page.

| Platform | Format |
|----------|--------|
| macOS    | `.dmg`, `.zip` (x64 + Apple Silicon) |
| Windows  | `.exe` (NSIS installer) |
| Linux    | `.AppImage`, `.deb` |

> **macOS note:** The app is not code-signed. macOS will quarantine it on first launch.
> After downloading, remove the quarantine flag before opening:
>
> ```bash
> xattr -cr /Applications/Hibiki.app
> ```
>
> Or right-click the app → **Open** → confirm in the dialog.

## Quick start (from source)

```bash
git clone https://github.com/phyberapex/hibiki.git
cd hibiki
nvm use
corepack enable && pnpm install
cp .env.example .env   # set DISCORD_TOKEN here, or configure it in Settings after starting
pnpm dev
```

This builds the backend and frontend, then launches the Electron app.
Set the Discord token in **Settings** if you haven't set `DISCORD_TOKEN`, then use the sidebar to join a voice channel and start playing scenes or streaming browser audio.

## Scripts

All scripts are run from the **repo root**.

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Build everything and launch the Electron app |
| `pnpm build` | Build backend (TypeScript) and frontend (Vite) without starting Electron |
| `pnpm dist` | Build and package the app for the current platform |
| `pnpm dist:mac` | Package for macOS (`.dmg` + `.zip`) |
| `pnpm dist:win` | Package for Windows (`.exe` installer) |
| `pnpm dist:linux` | Package for Linux (`.AppImage` + `.deb`) |
| `pnpm lint` | Run ESLint across backend and frontend |
| `pnpm test` | Run backend (Jest) and frontend (Vitest) tests |
| `pnpm test:e2e` | Run E2E tests (requires a running Hibiki instance and Discord config — see below) |

![Banner](banner.png)

## Project structure

```text
hibiki/
├── app/                    # Main application package (@hibiki/app)
│   ├── electron/           # Electron main process + preload
│   ├── frontend/           # Vue 3 + Vite (renderer process)
│   │   └── src/
│   │       ├── api/        # IPC wrappers (player, sounds, scenes, config, browser)
│   │       ├── audio/      # Web Audio capture (AudioWorklet)
│   │       ├── stores/     # Pinia stores
│   │       └── views/      # Vue pages (Scenes, Browser, Media, Settings, Welcome)
│   ├── src/                # Backend (runs in Electron main process)
│   │   ├── discord/        # Discord.js client
│   │   ├── player/         # Playback, volume, voice connections
│   │   ├── sound/          # Sound library (music, effects, ambience)
│   │   ├── scenes/         # Scene store + import/export
│   │   └── bootstrap-embedded.ts  # Wires everything up, exposes the IPC API
│   ├── web-dist/           # Built frontend (vite build output)
│   └── dist/               # Compiled TypeScript (backend)
├── e2e/                    # End-to-end tests (Playwright + Vitest)
└── docs/                   # Jekyll docs site (GitHub Pages)
```

## Storage

Hibiki stores data as JSON files:

- **`app-config.json`** — Discord token (when set in Settings), bookmarks, custom storage path.
- **`scenes.json`** — Scene definitions (soundboards with music, ambience, effects).
- **Sound files** — stored on disk under `music/`, `effects/`, `ambience/` directories.

When running as the Electron app, data lives in the platform's user data directory (e.g. `~/Library/Application Support/hibiki` on macOS). You can override paths via environment variables — see [.env.example](.env.example).

## E2E tests (real Discord)

The `e2e` workspace runs tests that connect to a real Discord server and drive the Hibiki API.

1. **Start Hibiki first** — `pnpm dev` — so the API is reachable.
2. Copy `.env.e2e.example` to `.env.e2e` and set **E2E_GUILD_ID**, **E2E_VOICE_CHANNEL_ID**.
3. Run: `pnpm test:e2e`.

See [e2e/README.md](e2e/README.md) for details on sidecar bot setup and optional config.

## Docs

- **[app/README.md](app/README.md)** — Architecture, local development, backend details.
- **Docs website** — The [docs/](docs/) folder is a Jekyll site deployed via GitHub Pages. See [docs/README.md](docs/README.md).

## Contributing

Contributions are welcome. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup, running lint and tests, and how to submit changes.

## License

[MIT](LICENSE)
