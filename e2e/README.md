# E2E Tests

Playwright tests run against the Hibiki Electron app.

## Running tests

From the repo root:

```bash
pnpm run build          # Build the app first
pnpm run test:e2e       # Run Playwright (Electron) tests
```

Or from the e2e package:

```bash
pnpm run test:playwright
```

## Electron 33 + Playwright compatibility

Playwright 1.58.x passes `--remote-debugging-port=0` as a CLI argument, which Electron 30+ rejects. A fix was merged in [Playwright #39012](https://github.com/microsoft/playwright/pull/39012) (Jan 2026). If you see `bad option: --remote-debugging-port=0`:

1. **Upgrade Playwright**: `pnpm add -D @playwright/test@latest` in the e2e package
2. **Or downgrade Electron**: Use `electron@^28.0.0` in the app package

## Environment

- `.env.e2e` – optional; set `E2E_GUILD_ID`, `E2E_VOICE_CHANNEL_ID`, `E2E_SIDECAR_TOKEN` for voice/sidecar tests
- `.env` in repo root – required for Discord; `DISCORD_TOKEN`

## API tests (Vitest)

The `test:api` script runs Vitest tests for the API and sidecar. These require an HTTP server exposing the REST API (not currently provided by the Electron app). Run `pnpm run test:api` when you have HTTP available.
