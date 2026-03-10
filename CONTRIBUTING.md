# Contributing to Hibiki

Thanks for your interest in contributing. This document explains how to get set up, run checks, and submit changes.

## Code of conduct

Be respectful and constructive. This is a hobby-friendly project; we're here to make a useful Discord bot and keep the codebase maintainable.

## Getting started

1. **Fork and clone** the repo (or clone directly if you have write access).
2. **Node and pnpm:** Use Node 20 or 22 (see [.nvmrc](.nvmrc); run `nvm use`). Enable pnpm: `corepack enable && pnpm install`.
3. **Environment:** Copy [.env.example](.env.example) to `.env` and set `DISCORD_TOKEN` (see [README](README.md#setting-up-a-discord-bot)). You can also set the token inside the app's **Settings** page after starting.
4. **Run the app:** `pnpm dev` builds everything and launches the Electron app.

## Before you submit

- **Lint:** From the repo root run `pnpm lint`. Fix any reported issues.
- **Tests:** Run `pnpm test`. All tests should pass. Fix or update tests if your change affects behavior.

We run these checks in CI; PRs are expected to pass lint and tests.

## Submitting changes

1. **Branch:** Create a branch from `main`. Use a descriptive name, e.g. `fix/panel-select-menu` or `docs/contributing`.
2. **Commit:** Make focused commits. Conventional commit messages are appreciated (e.g. `feat: add volume to control panel`, `fix: allow only one select menu per row`).
3. **Push and open a PR:** Push your branch and open a pull request against the base branch. Describe what you changed and why. Link any related issues if applicable.
4. **Review:** Address review feedback. Once the PR is approved and CI is green, it can be merged.

## Project layout

- **electron/** — Electron main process (IPC handlers, protocol handler, window management)
- **src/** — Backend (Discord bot, audio player, scenes, sound library)
- **frontend/** — Vue 3 UI (Electron renderer process)
- **e2e/** — End-to-end tests (Playwright + Vitest, requires running Hibiki instance)
- **docs/** — Jekyll site for documentation (GitHub Pages). See [docs/README.md](docs/README.md)

## Running GitHub Actions locally

You can run CI workflows locally with [`nektos/act`](https://github.com/nektos/act), which executes GitHub Actions in Docker. This is useful for debugging CI-specific failures (like Linux sandbox issues) without pushing and waiting for GitHub.

1. **Install:** `brew install act` (macOS) or see [act installation docs](https://nektosact.com/installation/).
2. **Set up secrets:**
   ```bash
   cp .secrets.example .secrets
   # Fill in DISCORD_TOKEN and any other values you need
   ```
3. **Run a workflow job:**
   ```bash
   act -j e2e       # Run the E2E job
   act -j lint       # Run the lint job
   act -j test       # Run the test job
   act               # Run all jobs triggered by push
   ```

The `.actrc` file configures defaults (Docker image and secrets file) so no extra flags are needed. Secrets in `.secrets` are gitignored.

## Questions or issues?

Open a [GitHub issue](https://github.com/phyberapex/hibiki/issues) for bugs, feature ideas, or documentation improvements.
