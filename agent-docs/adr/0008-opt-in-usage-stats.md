# 0008. Usage Stats are opt-in, identifier-free and sent from the main process

## Status

Accepted

## Context

The project wants to know roughly how many machines run Hibiki, on which OS and version, and which features (Output Targets, Routed Tabs, Hotkeys, Vision to Vibe, Music Modes) are actually reached, to decide where to invest. The docs site already reports to a self-hosted Umami instance (`analytics.phyberapex.de`), and the same instance is the natural home for the app's numbers (see `CONTEXT.md` for **Usage Stats**).

Three things made this more than "add a tracker":

- `docs/privacy.md` states in writing that the desktop app has no telemetry and no analytics. Any collection amends a public promise, and the self-hosting GMs Hibiki attracts are the audience most likely to check.
- Umami is page-centric and browser-centric. Its visitor id is a daily salted hash of IP and User-Agent, which yields "daily active machines", not "distinct installs". Counting installs would require Hibiki to mint and store a per-install identifier.
- The renderer runs on the privileged `hibiki://` scheme. Umami's `script.js` assumes an http(s) origin, auto-tracks every route change, and reports Chromium's User-Agent, so the dashboard would show "Chrome" rather than Hibiki and its version.

Alternatives considered:

- **Opt-out by default** for sample size. Rejected: it contradicts the privacy page and the trust it buys is worth more than the sample.
- **A stored per-install UUID** passed as the Umami session id, wiped on opt-out. Rejected: daily active machines is enough for the question asked, and "no identifier is stored" is a far cleaner sentence on the privacy page. Opting out leaves nothing to delete.
- **Loading `script.js` in the renderer.** Rejected for the origin, CSP, auto-track and User-Agent problems above.
- **Error or crash reporting through the same channel.** Rejected: Umami is the wrong tool, and `hibiki.log` already covers diagnostics.

## Decision

- **Opt-in, off by default.** A toggle in Settings and one dismissible first-run card that is shown once ever and never re-prompts. The privacy page is amended in the same change, listing the exact event set and stating that no identifier is stored.
- **No identifier.** Hibiki stores nothing that identifies the machine or the install. Umami's own daily hash is the only notion of a visitor.
- **Main-process transport.** The backend (`src/usage-stats/`) sends through `@umami/node` to committed constants (host and website id are public by nature, as the docs site's already are, with an env override for pointing a dev build at a test instance). The renderer only emits semantic events over IPC; it never loads anything from Umami.
- **The backend holds the allowlist.** Event names, permitted data keys and value enums live in one backend module; anything else is dropped with a `warn`. A renderer bug can never widen what leaves the machine, and the privacy page describes exactly one file.
- **Fixed event set:** `app-start` (platform, arch, app version, locale; once per launch and once when the toggle is switched on), `scene-play` (musicMode, item counts per category, target kind), `target-switch`, `routed-tab-toggle`, `hotkey-fired` (kind only, never the key), `vision-analyze` (provider kind), `registry-install` (public entry id). The Vue route path is sent as Umami's `url` with hostname `app.hibiki.phyberapex.de` (a syntactically valid domain, which Umami requires for the website record; it never needs to resolve), so the Pages panel doubles as a view-usage chart. Never guild, channel, Scene, sound or Hotkey names, URLs, or anything the GM authored.
- **Synthetic User-Agent** built in main from app version, Electron version, platform and arch, so Umami's OS and "browser" breakdowns read as Hibiki.
- **Fire-and-forget.** A send has a short timeout, is never retried or queued, and never blocks a user action. First failure per session is a `warn`, later ones `debug`; every send is logged at `debug` so a GM can audit what left the machine from `hibiki.log`.
- **Never from dev, test or unpackaged builds:** sends require `app.isPackaged` and honour an env kill switch so e2e and screenshot runs stay clean even against packaged artifacts.

## Consequences

- The dashboard answers "how many machines per day, on which OS and version, reaching which views and features". It cannot answer "how many installs" or "how many returning users"; accepting that is the price of storing no identifier.
- Adding an event is a change to one backend allowlist module, the privacy page and this ADR's event list, in the same PR. An event the privacy page does not list must not ship.
- Disabling sends nothing and deletes nothing, because there is nothing to delete.
- Reversing the opt-in default would mean amending the public privacy page a second time; treat that as a decision for a human, not an implementing agent.
