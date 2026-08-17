# 0001. Vision-to-Vibe matching: Sound Tags on the Sound Library, Claude as MVP vision provider

## Status

Accepted

## Context

Issue #319 proposes letting a GM drop an image (a battle map, mood board, character art) into Hibiki and get back suggested Music/Ambience sounds matching the image's "vibe," instead of manually browsing/searching their library mid-session.

The issue's original proposal assumed matching could rank "the closest matches already in the user's sound library... existing tags." That assumption doesn't hold: `SoundFile` (`src/sound/sound.types.ts`) — the type for a GM's own uploaded music/ambience/effects — has no `tags` field. The only `tags: string[]` in the codebase belongs to `RegistryEntry` (`frontend/src/api/registry.ts`), the separate curated community scene catalog (`registry/scenes/...`), not a GM's personal library.

This ADR records the decisions reached (via `/triage` + `/grilling` on #319) to close that gap and scope the MVP.

## Decision

- **Sound Tags**: add an optional `tags: string[]` field to `SoundFile`. Free-form strings, authored manually by the GM, edited inline per row in the existing sound-library list UI. No auto-tagging of existing audio in this MVP — a sparsely-tagged library gets a UI nudge, not an AI assist.
- **Vibe Tags**: a new `vision` IPC domain (`analyzeImageVibe(imagePath)`) calls a vision-capable model to extract free-form mood/setting/weather/time-of-day tags plus a short description from an uploaded image.
- **Provider**: Claude (Anthropic) only for MVP. Support for additional vision providers is tracked as a separate follow-up issue, not bundled into #319.
- **Matching**: case-insensitive exact/substring overlap count between Vibe Tags and each `SoundFile`'s Sound Tags, ranked descending, top ~5 surfaced per category.
- **Scope**: Music and Ambience categories only. Effects (one-shot triggered sounds) are excluded — a static image doesn't imply a situational trigger the way it implies a mood loop.
- **Entry point & flow**: a scene-level button in the scene editor (visible regardless of which category tab is active), augmenting the currently open scene. No new-scene-creation flow.
- **Results UI**: shows the extracted Vibe Tags/description first, then two independently-actionable ranked lists (top Music matches, top Ambience matches) — no bulk-accept, no auto-add of the top result.
- **Settings & consent**: new API key field, env var `HIBIKI_VISION_API_KEY` (falls back like `DISCORD_TOKEN` today), stored in `app-config.json`. A toggle defaulted off; the scene-editor entry point stays hidden/disabled until a key is set *and* the toggle is switched on.
- **Explicitly out of scope**: generative-audio (the issue's own "stretch" goal), Effects-category matching, auto-tagging of existing audio, multi-provider support.

## Consequences

- Adding `tags` to `SoundFile` is a small additive schema change (default `[]`), no migration needed for existing sound files.
- The feature is "you get out what you tag in" at launch — value is gated on GMs manually tagging their library, which may limit day-one usefulness for large untagged libraries. Accepted as a reasonable MVP tradeoff over building an auto-tagging pipeline.
- Introduces Hibiki's first third-party network dependency for a *creative* feature (vision analysis), separate from the existing Discord API dependency. Opt-in and clearly disclosed per the consent UX above.
- Locking the MVP to one vision provider (Claude) means the `vision` IPC domain's internal interface should stay provider-agnostic enough that a second provider (tracked separately) doesn't require reshaping the public API.
