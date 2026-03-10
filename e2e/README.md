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

- `.env.e2e` – optional; set `E2E_GUILD_ID`, `E2E_VOICE_CHANNEL_ID` for voice channel tests
- `.env` in repo root – required for Discord; `DISCORD_TOKEN`
- `.secrets` – used by `act` for local CI runs; copy from `.secrets.example`
