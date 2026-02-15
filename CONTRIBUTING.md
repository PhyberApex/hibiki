# Contributing to Hibiki

Thanks for your interest in contributing. This document explains how to get set up, run checks, and submit changes.

## About this repository

This project was created in large part with **AI-assisted coding tools**. The codebase is maintained like any open-source project; we welcome human review, testing, bug reports, and contributions.

## Code of conduct

Be respectful and constructive. This is a hobby-friendly project; we’re here to make a useful Discord bot and keep the codebase maintainable.

## Getting started

1. **Fork and clone** the repo (or clone directly if you have write access).
2. **Node and pnpm:** Use Node 20 or 22 (see [.nvmrc](.nvmrc); run `nvm use`). Enable pnpm: `corepack enable && pnpm install`.
3. **Environment:** Copy [.env.sample](.env.sample) to `.env` and set `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` (see [README](README.md#setting-up-a-discord-bot)).
4. **Run the app:** `pnpm dev` starts the bot and web dashboard. The dashboard is at http://localhost:5173 and proxies `/api` to the bot.

## Before you submit

- **Lint:** From the repo root run `pnpm run lint`. Fix any reported issues.
- **Tests:** Run `pnpm run test`. All tests should pass. Fix or update tests if your change affects behavior.

We run these checks in CI; PRs are expected to pass lint and tests.

## Submitting changes

1. **Branch:** Create a branch from `develop` (or `main`, depending on the project’s default). Use a descriptive name, e.g. `fix/panel-select-menu` or `docs/contributing`.
2. **Commit:** Make focused commits. Conventional commit messages are appreciated (e.g. `feat: add volume to control panel`, `fix: allow only one select menu per row`).
3. **Push and open a PR:** Push your branch and open a pull request against the base branch. Describe what you changed and why. Link any related issues if applicable.
4. **Review:** Address review feedback. Once the PR is approved and CI is green, it can be merged.

## Project layout

- **apps/bot** — NestJS backend, Discord bot, REST API. See [apps/bot/README.md](apps/bot/README.md).
- **apps/web** — Vue 3 dashboard (Vite, TypeScript). See [apps/web/README.md](apps/web/README.md).
- **docs/** — Jekyll site for the docs (e.g. GitHub Pages). See [docs/README.md](docs/README.md).

## Questions or issues?

Open a [GitHub issue](https://github.com/phyberapex/hibiki/issues) for bugs, feature ideas, or documentation improvements.
