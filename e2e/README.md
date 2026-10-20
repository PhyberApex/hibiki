# E2E Tests

Playwright tests run against the Hibiki Electron app.

## Test Structure

The e2e tests use Playwright to launch the Electron app and test it end-to-end through the UI. All tests are in `tests/web.e2e.spec.ts`.

**Note**: Previous HTTP API tests (`api.discord.e2e.spec.ts`, `sidecar.discord.e2e.spec.ts`) have been removed because the Electron app uses IPC communication only, not HTTP. Future API testing should be done via Playwright + IPC.

## Running tests

Tests run in **headless mode** by default (no visible windows).

From the repo root:

```bash
pnpm run build          # Build the app first
pnpm run test:e2e       # Run Playwright (Electron) tests
```

Or from the e2e package:

```bash
pnpm run test:playwright
```

To watch tests run in a visible window, see "Running tests in headed mode" below.

## Running tests in headed mode (watch tests run)

By default, E2E tests run in **headless mode** (no visible windows) which is ideal for CI/CD. To watch the tests execute in a visible Electron window:

```bash
# From repo root
HIBIKI_E2E_HEADED=1 pnpm run test:e2e

# Or from e2e package
HIBIKI_E2E_HEADED=1 pnpm run test:playwright
```

You can also add to your `.env.e2e` file:
```bash
# .env.e2e or root .env
HIBIKI_E2E_HEADED=1  # Set to watch tests run (comment out for headless)
```

**Tip**: Use headed mode when developing new tests or debugging test failures to see exactly what's happening in the UI.

## First-time setup

The e2e package is standalone (not part of the pnpm workspace). You need to install its dependencies separately:

```bash
cd e2e && pnpm install            # Install e2e dependencies
pnpm exec playwright install chromium  # Install Playwright browser
```

The root `pnpm test:e2e` script handles `pnpm install` automatically, but you still need to install the Playwright browser once.

## Marketing screenshots

`screenshots/capture.spec.ts` launches the built app against a throwaway, seeded user-data directory (three scenes, silent WAV files with Sound Tags, a few bookmarks) and saves 1440x900 PNGs to `docs/assets/screenshots/`. It needs no Discord token or network: the bot stays disconnected, secrets from your shell and the root `.env` are pinned to empty values, and the temp directory is deleted afterwards.

```bash
# From repo root (builds first)
pnpm run screenshots

# Or from the e2e package against an existing build
pnpm run screenshots
```

The window is shown while capturing (hidden windows never paint), so expect it to pop up briefly. The Browser tab's page area stays empty because the embedded `WebContentsView` is not part of the renderer capture.

## Running CI locally with `act`

[`nektos/act`](https://github.com/nektos/act) runs GitHub Actions workflows locally in Docker, reproducing the exact Linux CI environment. This is useful for debugging CI-specific failures (like Electron sandbox issues) without pushing to GitHub.

1. Install: `brew install act`
2. Copy `.secrets.example` to `.secrets` and fill in your values:
   ```bash
   cp .secrets.example .secrets
   # Edit .secrets with your real tokens/IDs
   ```
3. Run the E2E workflow:
   ```bash
   act -j e2e
   ```

The `.actrc` file in the repo root configures `act` to use the correct Docker image and secrets file automatically.

## Environment

- `.env.e2e` – optional; set `E2E_GUILD_ID`, `E2E_VOICE_CHANNEL_ID` for voice channel tests, `E2E_SIDECAR_TOKEN` for the sidecar bot
- `.env` in repo root – required for Discord; `DISCORD_TOKEN`
- `.secrets` – used by `act` for local CI runs; copy from `.secrets.example`

## Sidecar bot (Discord-side verification)

`E2E_SIDECAR_TOKEN` is the token of a **second** bot that is in the same test server with permission to connect to the voice channel. It never plays anything; it observes Hibiki from the outside:

- **join / leave** – asserts Hibiki's voice state (through `sidecar-helper.ts#voiceChannelOf`) is the configured channel after joining and empty after leaving. Without the sidecar, these tests only check Hibiki's own UI.
- **music played to Discord reaches another member** – uploads a WAV, joins the configured channel, starts Music, then the sidecar joins the same channel (muted, not deafened) and counts the Opus packets Hibiki sends. The test fails unless Discord reports Hibiki as speaking **and** packets carrying audio arrive. It is skipped when the sidecar is not configured.
- **ambience and effects reach another member and stop** – Ambience (repeat 0-0 s) and a 3 s Effect each deliver audio; after `stopAmbience`, and after the Effect plays out, only Opus silence frames arrive.
- **Output Target handover** – plays a Scene on Local, switches to Discord (audio arrives, Local state empties), then back to Local (Discord gets only silence frames, Local plays the track again); `playingSceneMode` follows the Target.
- **silence is sent, not dropped** – with silent Music playing, Hibiki keeps sending at least 30 packets/s.

"Stopped" never means Hibiki stops sending: the voice player sends a 3-byte Opus silence frame (`F8 FF FE`) every 20 ms while connected (`maxMissedFrames: Infinity`, see ADR-0003), and Discord counts that as speaking. The sidecar tells silence frames from audio, so "stopped" is asserted as "only silence frames, at ~50/s". The silent WAV fixtures still count as audio: Hibiki encodes stereo, so encoded digital silence is `FC FF FE`.

The ambience/effects and handover tests also check their `join`/`playAmbience`/`playEffect`/target-switch lines in `hibiki.log`. Each test removes its uploads and leaves the channel in `finally`.

If the sidecar token is set but the sidecar cannot log in, or Hibiki never reaches `ready`, the run fails rather than silently skipping the Discord-side checks.

## Local Target test (no secrets)

`tests/local-target.e2e.spec.ts` seeds a throwaway profile (`HIBIKI_USER_DATA_DIR`) and plays Music, Ambience and an Effect through the Local Target with no Discord token. `tests/scene-ui.e2e.spec.ts` does the same through the UI: it creates a Scene in the editor, plays, toggles, triggers and stops it from the Scene view, moves the master volume and deletes it. Run either on its own with `pnpm exec playwright test tests/<file>` (under `xvfb-run` on a headless Linux box); CI runs both in the `e2e-local` job.
