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

## Electron 33 + Playwright compatibility

Playwright 1.58.x passes `--remote-debugging-port=0` as a CLI argument, which Electron 30+ rejects. A fix was merged in [Playwright #39012](https://github.com/microsoft/playwright/pull/39012) (Jan 2026). If you see `bad option: --remote-debugging-port=0`:

1. **Upgrade Playwright**: `pnpm add -D @playwright/test@latest` in the e2e package
2. **Or downgrade Electron**: Use `electron@^28.0.0` in the app package

## Environment

- `.env.e2e` – optional; set `E2E_GUILD_ID`, `E2E_VOICE_CHANNEL_ID` for voice channel tests
- `.env` in repo root – required for Discord; `DISCORD_TOKEN`
