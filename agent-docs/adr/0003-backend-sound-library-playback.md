# 0003. Backend Sound Library playback: main-process JS/WASM decoders

## Status

Accepted

## Context

Issue #414 moves Sound Library playback for Discord into the Electron main process: the backend decodes Music, Ambience and Effects files straight into the per-guild mixer (`AudioEngine`, `src/audio/audio-engine.ts`) and owns playback state per guild, as `CLAUDE.md` already (aspirationally) describes. Today none of that exists — `src/player/player.ts` only exposes `startStream`/`startEffectStream`, and all Scene playback happens in the renderer via `HTMLAudioElement` + chunked IPC (`frontend/src/views/SceneView.vue`).

The work is split into sub-issues, chained with blocked-by, so each lands as one focused agent run:

1. #415 (this ADR) — ADR and the decoder module, no GM-visible behaviour change.
2. #416 — Music
3. #417 — Ambience
4. #418 — Effects
5. #419 — Master volume, cleanup and docs

This ADR, numbered 0003 because ADR-0002 (Vision Providers) already exists, records the decisions from #414's triage that apply to the decoder foundation, ahead of #416–#419 wiring it into actual playback.

## Decision

- **Where decoding happens**: in the Electron main process. A Sound Library file is read from disk and decoded straight into PCM that feeds `AudioEngine`'s `node-audio-mixer` inputs (48 kHz, stereo, signed 16-bit little-endian). Playback state stays per guild in `GuildAudioManager`.
- **Decoders: JS/WASM only, no bundled ffmpeg binary.** Four small packages from the `wasm-audio-decoders` family cover the required formats, each shipping its WASM binary base64-embedded in its JS bundle (no separate `.wasm` file I/O, so no asar-unpacking is needed for them — see `forge.config.js`'s `asar.unpack`, which only covers native `.node` modules like `@discordjs/opus`):
  - `mpg123-decoder` — MP3
  - `@wasm-audio-decoders/ogg-vorbis` — Ogg Vorbis
  - `ogg-opus-decoder` — Ogg Opus (used with `forceStereo: true`; libopus always decodes at 48 kHz, so this path needs no sample-rate conversion, only channel up-mixing)
  - `@wasm-audio-decoders/flac` — FLAC
  - WAV has no decoder package — a hand-rolled RIFF chunk walker (`src/audio/decoders/wav-decoder.ts`) reads past arbitrary chunks (e.g. the `LIST`/`INFO` metadata chunk ffmpeg writes before `data`) to find the `data` chunk, then converts PCM/IEEE-float samples of any supported bit depth directly.
  - **Packaging caveat, verified before committing to these packages**: all four are ESM-only (`"type": "module"`), while this repo's backend compiles to CommonJS (`tsconfig.json`'s `"module": "commonjs"`). A plain `import` of an ESM-only package compiles to `Promise.resolve().then(() => require(...))`, and `require()` of an ESM module only works because Node 24 (already required — see `.nvmrc`, `package.json#engines`, and CLAUDE.md's Node-version rule) supports synchronous `require(esm)` natively; this was confirmed to work both via `tsc --build` and inside the compiled `dist/` output. Jest, however, gates its own equivalent support behind Node's `--experimental-vm-modules` flag (it probes for `vm.SourceTextModule`, which only exists with that flag), so `test:backend`/`test:watch`/`test:coverage:backend` in `package.json` now run `node --experimental-vm-modules node_modules/.bin/jest` instead of invoking `jest` directly — otherwise Jest throws `ERR_REQUIRE_ESM` the moment a spec imports the decoder module.
  - `ogg-opus-decoder` pulls in `@wasm-audio-decoders/opus-ml` (~8 MB unpacked) as a dependency for an optional speech-quality-enhancement mode this project doesn't use; it's lazy-loaded (`import(/* webpackChunkName: "opus-ml" */ ...)`) only when the `speechQualityEnhancement` option is passed, which Hibiki never does, so it adds to on-disk `node_modules`/packaged size but is never evaluated at runtime.
- **Streaming, not whole-file buffering**: every decoder here accepts chunked input (`decode(chunk)` called repeatedly, `flush()` at the end for the three `wasm-audio-decoders` packages), so `src/audio/decoders/read-chunks.ts` reads the source file in fixed-size chunks (`fs.createReadStream`) instead of loading it whole. The WAV reader streams the `data` chunk the same way via positioned `FileHandle.read()` calls. A single stateful `PcmResampler` (`src/audio/decoders/pcm-resample.ts`, linear interpolation, phase carried across `push()` calls) turns each decoded chunk — at whatever native sample rate/channel count the file has — into continuous 48 kHz stereo PCM, so chunk boundaries don't click or reset resampling phase.
- **Ogg container ambiguity**: a `.ogg`/`.oga`/`.opus` file can hold Vorbis or Opus; the extension alone doesn't say which. `src/audio/decoders/ogg-sniff.ts` reads the first Ogg page (a few KB at most) and looks for the `OpusHead` or `\x01vorbis` codec-identification marker before picking a decoder.
- **Formats with no backend decoder (m4a/AAC, and anything else)**: `canDecode()` returns `false`; no native dependency is added to support them. Per #414, those files keep playing through today's renderer path (audio element → chunked IPC) — nothing in an existing library stops working. Local preview (not in a voice channel) also stays in the renderer per #414, unaffected by this ADR.
- **Surfacing the capability**: `sounds.canDecode(type, id)` is exposed over IPC (`src/bootstrap-embedded.ts`, wrapped in `frontend/src/api/sounds.ts`) so #416–#419 can route an individual sound to the backend-decode path or the renderer fallback. This issue only adds the capability check — no playback code calls it yet, so there is no GM-visible behaviour change.
- **Overlapping Effects (#408) and Scene crossfade (#409)**: both already shipped in the renderer before this ADR. Nothing here changes `AudioEngine`'s per-stream-id model (`playMusicFromStream`/`playEffectFromStream`, `src/audio/audio-engine.ts`), which both behaviours depend on; #416–#419 are responsible for preserving them when wiring actual playback through these decoders.

## Consequences

- Four new runtime dependencies (plus their shared `@wasm-audio-decoders/common` and the unused `opus-ml` chunk), all WASM-in-JS with no native/.node binaries — no new asar-unpacking rules needed, unlike `@discordjs/opus`.
- The ESM/CommonJS interop relies on Node 24's `require(esm)` support, which is already a hard requirement for this project (Electron 41+ needs Node 24+) — no new minimum-version constraint, but it is now also load-bearing for decoding, not just for running tooling.
- `pnpm test`/`pnpm test:watch`/`pnpm test:coverage` now launch Jest via `node --experimental-vm-modules node_modules/.bin/jest` instead of the `jest` bin directly; this is Jest's documented, non-breaking way to support `require(esm)`, and produces identical results for every existing spec.
- Mono sources are up-mixed to stereo (duplicated to both channels) and anything beyond two channels is read as its first two; Hibiki's own uploads are expected to be mono or stereo, so this is not expected to matter in practice.
- `PcmResampler`'s linear interpolation is adequate for mixing voice-channel audio (sound effects, ambience loops, background music) but is not broadcast-quality band-limited resampling; accepted as proportionate to the use case.
