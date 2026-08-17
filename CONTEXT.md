# Hibiki — Domain Context

Single-context repo (see `agent-docs/domain.md` for how this file is meant to be used). Architectural decisions live in `agent-docs/adr/`.

## Glossary

- **Scene** — a soundboard template (Music, Ambience, Effects categories) stored in `scenes.json`. Not a runtime object; playback state lives in `GuildAudioManager`. See `CLAUDE.md`.
- **Sound Library** — the GM's own uploaded sound files (`SoundFile`, `src/sound/sound.types.ts`), organized by category (`music` | `effects` | `ambience`). Distinct from the **Registry**.
- **Registry** — the separate curated catalog of community-shared scene bundles (`RegistryEntry`, `registry/`), installable into a user's own scenes via `installFromRegistry`. Registry entries carry their own `tags: string[]`.
- **Sound Tags** — free-form `tags: string[]` on a `SoundFile` (Sound Library), authored manually by the GM per sound. Used for Vibe Matching (see `agent-docs/adr/0001-vision-to-vibe-matching.md`). **Do not confuse with Registry tags** — same field name, different domain object, different purpose (Registry tags describe a shared community scene; Sound Tags describe one of the GM's own files).
- **Vibe Tags** — free-form tags extracted from an uploaded image by a vision-capable model, describing mood, setting, weather, or time-of-day.
- **Vibe Match** — a ranked Sound Library entry (Music or Ambience only) whose Sound Tags overlap with a set of Vibe Tags.
