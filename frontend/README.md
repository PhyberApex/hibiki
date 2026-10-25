# Hibiki Frontend

Vue 3 frontend for the Hibiki Electron app. This is the renderer process that provides the desktop UI.

## Development

Run from repository root:

```bash
pnpm dev           # Build and launch Electron app
pnpm build         # Build frontend only (outputs to web-dist/)
```

## Architecture

- **Vue 3** with Composition API (`<script setup>`)
- **Pinia** for state management
- **Vue Router** for navigation
- **Vite** for fast builds and HMR

### Key Directories

- `src/api/` — IPC wrappers that call Electron main process
- `src/audio/` — Web Audio API capture (AudioWorklet for browser streaming)
- `src/stores/` — Pinia stores (player state, guild directory)
- `src/views/` — Pages (Welcome, Scenes, Browser, Media, Settings). Welcome offers two equal paths: "Play at the table" (sets the Local Output Target, no token needed) and "Play in Discord" (Discord Target; token set up in Settings, where it is optional).

### Communication

All backend communication uses Electron IPC via the preload bridge. No HTTP API.

See [CONTEXT.md](../CONTEXT.md) for the domain vocabulary and [agent-docs/adr/](../agent-docs/adr/) for design decisions.
