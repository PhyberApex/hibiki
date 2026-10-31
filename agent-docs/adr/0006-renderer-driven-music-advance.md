# 0006. The renderer drives the Music Mode advance

## Status

Accepted

## Context

Issue #539 gives a Scene a **Music Mode** (single, sequential, shuffle; see `CONTEXT.md`). In sequential and shuffle, when the current Music track plays out the next track of the Scene's Music list has to start, crossfading in over the Scene fade length, so a long session never drops to silence between tracks.

Two places could own that advance:

- **The backend.** `GuildAudioManager` already restarts a looping track from its `onEnded` callback (ADR-0003) and could take a queue of tracks and chain them itself. It would keep advancing even if the renderer were wedged, and a true overlap crossfade (next track starting a few seconds *before* the end) would be a backend-only change.
- **The renderer.** The scene playback store already orchestrates everything else about a Scene: it iterates the Scene's items, applies the master volume, runs the Scene Crossfade with one outgoing and one incoming track, and owns the m4a renderer fallback, which the backend cannot see at all.

Two facts shaped the choice. First, the backend Music path streams its decode into the mixer and never knows a track's duration up front (only Effects are fully pre-decoded, for their cache); a "start the next track N seconds before the end" overlap would need duration probing that does not exist. Second, a Scene is a template and the backend knows nothing about Scenes (`CLAUDE.md`, ADR-0003); the Scene fade and Scene Crossfade were deliberately placed in the renderer for that reason, and a hidden Electron window is not timer-throttled the way a background browser tab is.

## Decision

- **The renderer advances.** The scene playback store learns that the current track played out (the backend's state push reporting its track gone, or the audio element's `ended` on the renderer fallback path), picks the next track from the Scene's live Music list according to the Music Mode, and starts it through the same `playMusic` call with the Scene fade length as `fadeInMs`. The backend's only Music concepts stay `playMusic`, `stopMusic`, loop and fades; it never sees a list, a mode or a Scene.
- **Advance at end, no overlap.** The next track starts when the outgoing one has played out, fading in over the Scene fade length (0 is a hard cut). This reuses the existing Music Crossfade machinery on both paths without new backend capability. A true overlap is a possible follow-up once the backend can report a track's duration; it is not a prerequisite.
  - *Amended 2026-10-31 (#738):* the advance now overlaps. Since a track's duration is known from its file header (#702), the store arms a renderer timer when a sequential or shuffle track's start is confirmed: with the Scene fade length read at that moment, `overlapMs = min(fadeLength, duration / 2)`, and the timer runs the same advance (`crossfadeMusic` through the same next-track selection) `overlapMs` before the end, crossfading over `overlapMs`. A fade length of 0, an unknown duration and single mode arm no timer and keep the advance at the end. An end that beats the timer (an overestimated duration) advances at once and cancels it; every takeover (Stop, a jump, Scene Crossfade, a Target switch) cancels a pending timer. The backend still sees only `playMusic` with a `fadeInMs`.
- **"Played out" and "stopped" must be told apart.** A Stop, a Scene Crossfade away, a Target switch or a jump all end the current track without an advance. The store treats only an unsolicited end as an advance trigger; a generation or ownership check guards against a stale end event advancing after the GM has already moved on.
- **The advance follows the Scene the track came from.** The store records the source Scene id next to the current track, so the mode applies whether or not that Scene is the Playing Scene, and the next track is chosen from that Scene's current Music list at advance time.
- **Logging.** Every advance at `info` (Scene id, mode, outgoing and incoming sound id), every skipped unplayable track at `warn`, a full pass with nothing playable at `warn`, and every suppressed end (stopped, not played out) at `debug`.

## Consequences

- Queue state (mode position, shuffle bag, source Scene) lives in the renderer's playback store; moving it to the backend later means re-deriving the Scene from a sound id or teaching the backend about Scenes.
- The advance stops if the renderer process dies, which is already true of everything else about Scene playback.
- The brief gap between tracks is a fade-in only, not a crossfade overlap; GMs with tracks that end abruptly will hear a short dip at the seam. A later overlap feature changes only the timing of the same call, not the ownership.
  - *Amended 2026-10-31 (#738):* with a known duration and a fade length above 0 the seam is now a crossfade overlap, and as predicted only the timing of the call changed. The dip remains for tracks whose duration is unknown or with a hard cut. A duration estimate that runs long (a VBR mp3) falls back to the end-triggered advance for that track; one that runs short starts the next track early by the error.
- `scenes.json`, the `.hibiki.zip` package format and the Registry schema gain an optional Music Mode field; missing means single, so existing files and bundles are unchanged in behaviour.
