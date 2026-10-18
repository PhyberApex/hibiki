# 0004. Local Output Target: the backend mixes, the renderer is the sink

## Status

Accepted

## Context

Issue #511 asks for local playback (the GM's own speakers, for an in-person table) to be a first-class citizen instead of the renderer-only "preview" that exists today. The current preview is a separate implementation in `frontend/src/views/SceneView.vue`: `HTMLAudioElement`s driven directly from Vue, with its own partial copy of the playback rules. Discord playback, by contrast, is the backend path from ADR-0003: JS/WASM decoders feed `AudioEngine`'s `node-audio-mixer` per guild, and `GuildAudioManager` owns loops, Ambience random-interval repeats, fades, generation counters and the Effect Instance cap.

Making local output a peer of Discord output forces three decisions: what the unit of playback ownership is once a Discord guild is no longer the only one, which engine produces the local mix, and how the mix reaches the speakers given that this project deliberately ships no native Node modules for audio (Opus is encoded through `opusscript` WASM so dev and packaged builds share one path; `@snazzah/davey` is the sole native exception and is Discord's, not ours).

The domain vocabulary this ADR relies on (**Output Target**, **Discord Target**, **Local Target**) is defined in `CONTEXT.md`.

## Decision

- **The Output Target is the unit of playback ownership, not the Discord guild.** Every playback call is addressed to a Target id. A Discord guild is one kind of Target; the Local Target is another and exists without a Discord token or bot login. `GuildAudioManager`'s responsibilities become the Target's engine; the class may keep its name for a while, but the player API stops pretending every Target is a guild.
- **Exactly one Target is active at a time, by design but not by model.** The model is a set of Targets so simultaneous output (hybrid tables: GM's speakers plus the bot in voice) can be added later. Shipping only an exclusive switch avoids keeping two mix graphs in step on volume, crossfades and Ambience intervals.
- **The backend mixer is the only engine. The Local Target is a second sink for it.** The main process decodes and mixes exactly as for Discord, and ships the mixed 48 kHz stereo signed 16-bit LE PCM to the renderer over chunked IPC (the existing `audio:*` chunk pattern, in the opposite direction). The renderer plays it through Web Audio behind a jitter buffer of roughly 100 ms. One implementation of every playback rule; the renderer preview engine is retired.
- **No native output module.** `speaker`, `naudiodon` and similar would let the main process output directly, but they reintroduce per-platform native builds and the "works in dev, silent when packaged" class of bug the WASM-only voice stack was adopted to eliminate.
- **Two sources stay renderer-native under the Local Target.** The Browser tab (`WebContentsView` audio already plays through the speakers) and a Sound Library file with no backend decoder (m4a/AAC; the `HTMLAudioElement` is already the output) bypass the mix locally rather than round-tripping renderer → backend → renderer. Master volume and fades for those two are applied by the renderer, as the fallback does today. _Amended by ADR-0007: the Browser tab no longer plays natively while routed to the Local Target; the renderer mutes the view and replays its captured audio through a gain node, still without a backend round trip._
- **Switching Target mid-Scene is a hard handover.** Stop on the old Target, restart the Playing Scene from the top on the new one. No cross-Target crossfade: a Target switch is a setup action and remote listeners cannot hear a local fade anyway.
- **Master volume is stored per Target.** The in-person room level and the Discord mix level are unrelated; one slider shows the active Target's value.
- **The sink reports its own health.** AudioContext suspension, device loss and underruns happen in the renderer where the backend cannot see them. The renderer reports sink lifecycle over IPC so it lands in `hibiki.log`, and a dead sink stops playback instead of letting the backend mix into silence (the 1.4.0 "bot shows as speaking but nobody hears it" lesson).
- **Default Target on first launch** is Local when no Discord token is stored, otherwise Discord, so existing installs see no change. The Scene view's guild and channel controls are hidden while the Local Target is active.
- **Out of scope**: output-device selection (Web Audio `setSinkId`), filed separately once the sink exists.

## Consequences

- One set of playback semantics (loops, interval repeats, fades, Effect Instance cap, generation counters) applies to both Targets, and bugs fixed once are fixed for both. The renderer loses roughly a thousand lines of preview-only logic in `SceneView.vue`.
- Local playback gains IPC latency plus the jitter buffer, on the order of 100 ms from an Effect tap to sound. This is imperceptible at a table and was chosen over chasing minimum latency with crackle risk on slower machines.
- A long-lived high-volume IPC stream now runs from main to renderer whenever the Local Target is playing. Renderer freezes (devtools pauses, heavy UI work) show up as underruns, which is why sink health reporting is part of the design rather than a follow-up.
- The Browser tab and m4a fallback behave slightly differently under Local (no mixer, renderer-side volume). This is a documented asymmetry accepted to avoid a pointless round trip.
- The player API, state shape (`getState()` per Target rather than per guild), persistence (`app-config.json` gains the active Target and per-Target master volume) and the Welcome/Settings onboarding all change. The work is split into stacked issues under #511 so each lands as one focused PR.
