# CLAUDE.md

Guidance for agents working in this repository. The code, `package.json` scripts and `.env.example` answer "what exists"; this file holds what they cannot: rules, conventions and the reasons behind non-obvious choices.

## Project

**Hibiki (響)** is an Electron desktop companion that plays music, ambience and sound effects into Discord voice channels or the GM's own speakers, built for tabletop Game Masters. Domain vocabulary lives in `CONTEXT.md` (glossary: Scene, Output Target, Routed Tab, Music Mode, ...), decisions in `agent-docs/adr/`. Use those terms in code, issues and docs.

Processes: `electron/` is the main process shell (window, IPC plumbing, hotkeys, protocol), `src/` the backend services that run inside it, `frontend/` the Vue 3 renderer, `e2e/` a separate Playwright workspace.

## Working rules

- **Node version**: run `nvm use` before any `pnpm` command; in a fresh shell use `source ~/.nvm/nvm.sh && nvm use && <command>`. Node 24 is load-bearing: the backend's CommonJS output `require()`s ESM-only decoder packages through native `require(esm)`, and Jest needs `--experimental-vm-modules` for the same (already baked into the `test:*` scripts, so always go through them or copy their flags).
- **After every code change** run `pnpm lint` and `pnpm test` and fix what they report before calling the change done. Blocking.
- **Logging is part of every change** (see Logging below). New or changed behaviour must leave a trace in `hibiki.log`: entry point, outcome, failure paths. The 1.4.0 Windows "bot joins but is silent" bugs went undiagnosed for a release because the packaged app logged nothing.
- **IPC only, no HTTP.** Frontend and backend talk through the `preload.js` bridge. Adding a backend capability: service method in `src/`, expose it on `EmbeddedApi` in `src/bootstrap-embedded.ts`, let the generic `api` handler in `electron/main.js` carry it (a dedicated channel only when state must live in main, like hotkeys and audio streams), typed wrapper in `frontend/src/api/`.
- **Single test file**: backend `node --experimental-vm-modules node_modules/.bin/jest --config jest.config.js <file>`, frontend `cd frontend && npx vitest run <file>`.
- **E2E** launches the built app: `pnpm build` first. The Discord suite needs `DISCORD_TOKEN` in `.env` plus `e2e/.env.e2e` (see `e2e/README.md`); the Local Target suite needs no token. `electron/main.js` and `preload.js` are covered only by e2e; the other `electron/*.js` modules have Jest specs.
- **Electron majors**: PR CI builds and runs e2e but never packages. Before merging an Electron bump, read its breaking-changes doc against `electron/` and run `pnpm package` locally, booting the result against a throwaway `HIBIKI_USER_DATA_DIR`.

## Storage and environment

User data lives in Electron's `userData` directory: `app-config.json` (settings and secrets), `scenes.json`, `sound-tags.json`, the sound folders and `logs/hibiki.log`. `.env.example` lists every env override. Secrets from env (`DISCORD_TOKEN`, the Vision keys) win over their stored counterpart; the Vision Provider selection has no env var. `HIBIKI_USER_DATA_DIR` moves the whole `userData` directory and is how e2e and the screenshot capture get a throwaway profile. Secret keys are encrypted at rest through a `SecretCodec` built in main from `safeStorage` (#412); on Linux the `basic_text` backend counts as unavailable because it does not encrypt.

## Audio: the rules that are easy to break

ADR-0003 (backend playback), ADR-0004 (Local Target sink) and ADR-0007 (Routed Tabs) explain each of these in full with the measurements behind them. Read the ADR before touching `src/audio/`.

- Decoded PCM reaches a mixer input only through `feedMixerInput`; `node-audio-mixer` inputs have no backpressure of their own.
- The mixer runs with a one-packet `highWaterMark` (`MIXER_PACKET_BYTES`) and `generateSilence: false`; `maxMissedFrames` is `Infinity`. Never re-enable `generateSilence` and never assume the voice player's `play()` ran once and stays playing.
- "Finished playing" is the `onEnded` callback after the mixer input drains, never the source stream's `end` (which only means "fully decoded"). Loop and interval restarts hang off `onEnded`.
- `player`/`AudioEngine` have no master-volume concept: every `playMusic`/`playAmbience`/`playEffect` call carries a final absolute 0–100 `options.volume`, already multiplied by the master volume in the renderer (`computeVolume()`). There is no per-guild volume API (removed in #419). The one live-adjustable chunked-IPC input is a keyed effect stream (a Routed Tab) via `setEffectStreamVolume`.
- A Sound Library file with no backend decoder (m4a/AAC) takes the renderer fallback: audio element, chunked IPC under a Discord Target, the element itself under the Local Target. `sounds.canDecode` decides per sound.
- Scene Stop, the Stop Hotkey and Stop all Effects never touch effect streams, so Routed Tabs survive them.
- Music Mode (ADR-0006) is driven entirely by the renderer's scene playback store; `GuildAudioManager`/`player`/`AudioEngine` know nothing about modes or lists.
- The Scene is a template. Playback state lives per Output Target in `GuildAudioManager`; think Target-first (a guild id or `LOCAL_TARGET_ID`). Switching Target is a hard handover: stop on the old, restart the Playing Scene from the top on the new.

## Feature policies

- **Vision to Vibe** (ADR-0001, ADR-0002): opt-in, off by default. The button renders only when the toggle is on and the selected provider is configured (Claude needs a key; `openai-compatible` needs a key or a non-default Base URL); the backend re-checks the gate. Never retain the analyzed image.
- **Update Notice**: one GET to the GitHub Releases API at launch, never blocking startup, skipped when the toggle is off. Notice only, no download or install, so package managers keep updating. Only the GM's explicit dismiss remembers a version. The README Privacy section lists everything the app contacts; keep it current.
- **Usage Stats** (ADR-0008): opt-in, off by default, no identifier stored. `createUsageStats` is the single gate and takes "unpackaged build" and `HIBIKI_USAGE_STATS=off` as injected flags from main, never reading them itself. **Adding or widening an event changes the allowlist, `docs/privacy.md`, the Settings "What is sent" list and ADR-0008 in the same PR.**
- **Global Hotkeys** (ADR-0005): main only registers and forwards; resolution and action happen in the renderer, one press at a time.

## Logging

Every bug report from a packaged build arrives with exactly one artifact: `<userData>/logs/hibiki.log`. Code that does not log there is invisible in production.

- **Backend (`src/`)**: `createLogger('module')` from `src/logger.ts`. `debug` for hot-path detail (per-stream, per-tick), `info` for every user-triggered action and state change (join/leave, play/stop, config writes, voice and AudioPlayer transitions), `warn` for degraded-but-handled, `error` for failures with the error object. `console.*` only inside `src/logger.ts`.
- **Main process (`electron/`)**: `createLogger('area')` from `electron/logger.js`, same levels. The generic `api` handler logs every failed call, so a backend method only logs what the error alone would not explain.
- **Renderer (`frontend/`)**: `console.warn`/`console.error` with a `[view]` prefix, `logInfo`/`logDebug` from `frontend/src/audio/audio-element-diagnostics.ts` for the rest. Main captures warnings, errors and any info/debug line starting with `[` into the same file; Vue errors, uncaught errors and rejections are routed there by `frontend/src/main.ts`.
- **Never log** tokens, API keys, image contents or anything a GM would not want in a bug report. Log that a secret was set or cleared, not its value.
- **When adding a feature**, log its entry point (what was asked, with ids and the few parameters that matter), its outcome and every failure path. If a future "it does nothing on my machine" report could not be diagnosed from the log alone, the logging is incomplete.

## Agent workflow

- Issues and specs: GitHub Issues (PhyberApex/hibiki) via `gh`, see `agent-docs/issue-tracker.md`.
- Triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`, see `agent-docs/triage-labels.md`.
- Domain docs: `CONTEXT.md` + `agent-docs/adr/`, see `agent-docs/domain.md`.

## Design Context

### Users
D&D / TTRPG Game Masters running tabletop sessions. They're switching scenes, triggering sound effects, and managing ambience in real-time while simultaneously running a game. The UI must be quick to operate under pressure — one hand on the mouse, eyes mostly on the table. Clarity and speed matter more than exploration.

### Brand Personality
**Immersive, Crafted, Warm** — Like a well-made instrument or a tavern fireplace. The app should feel purposeful and inviting, not sterile or overly technical. It's a companion to storytelling, not a recording studio.

### Aesthetic Direction
- **Visual tone:** Dark, warm, atmospheric — a game companion aesthetic inspired by D&D Beyond. Rich but not gaudy.
- **Theme:** Dark mode only. Deep backgrounds (`#0c0c0e`), elevated cards (`#161618`/`#1a1a1d`), warm accent opportunities.
- **Accent color:** Cyan (`#06b6d4`) is the primary accent. Consider warm secondary accents (amber/gold) for adventure-themed elements — the welcome screen already uses `#fbbf24` gold.
- **Typography:** Plus Jakarta Sans (400–800). Clean, modern, slightly rounded — fits the "crafted" personality.
- **Anti-references:** Avoid sterile enterprise dashboards, neon-heavy gamer aesthetics, or clinical white-space minimalism. Should not look like a generic admin panel.

### Design Principles
1. **Session-ready** — Every interaction should be fast and confident. GMs use this mid-game; minimize clicks, maximize clarity. No ambiguity in controls.
2. **Atmospheric, not decorative** — Design should evoke the feeling of a well-set game table. Use subtle depth, warm shadows, and muted textures rather than ornamental fantasy elements.
3. **Sound-first hierarchy** — Audio controls (play, stop, volume) are the primary actions. They should be the most visually prominent and easiest to reach.
4. **Quiet confidence** — The UI stays out of the way until needed. Subtle transitions, restrained color use, no unnecessary animation. Let the content (scenes, sounds) be the focus.
5. **Accessible by default** — Good contrast ratios, keyboard navigation, semantic HTML. No specific WCAG target, but standard best practices throughout.
