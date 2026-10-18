# 0007. A Routed Tab under the Local Target is muted and replayed from its own capture

## Status

Accepted

## Context

Issue #540 asks that a Browser tab follow the active Output Target's Master volume and get its own Tab Volume (see `CONTEXT.md` for **Routed Tab** and **Tab Volume**). Under a Discord Target the tab is already captured in the renderer (Chromium tab capture of the `WebContentsView`) and streamed into the guild's mix, so a level is just a live volume on that mixer input. Under the Local Target, ADR-0004 left the tab playing natively from the `WebContentsView`, and Electron offers a `WebContents` mute but no level, so there was nothing to scale.

Two mechanisms were considered for the Local Target:

- **Page-script volume.** `executeJavaScript` into the page to set `volume` on its media elements. Zero added latency, but blind to cross-origin iframes (most embedded players), to Web Audio-based players, and to sites that reset the property; it also means Hibiki running script inside third-party pages.
- **Mute and replay.** Mute the `WebContentsView` while the tab is routed and play the same tab-capture stream the Discord path already uses through Web Audio with a gain node. Works for any page because it operates on the rendered audio, and the gain path naturally lands on the Output Device chosen in Settings, which the native path could not.

## Decision

- **Mute and replay.** While a tab is routed under the Local Target the view is muted and its captured audio is played by the renderer through a gain node whose level is Tab Volume × Master volume. Un-routing, closing the tab or a Target handover unmutes the view and tears the gain path down. This stays renderer-only: the capture never round-trips through the backend mixer, so ADR-0004's "no pointless round trip" still holds; only its "plays natively" wording is amended.
- **Page-script volume is rejected**, not deferred. It must not be adopted as a fallback by an implementing agent; if muted tab capture turns out to carry no audio, the issue returns to a human for a new decision.
- **A routed tab stays on the effect lane under Discord**, keyed by its stream id with a live volume call, rather than moving to the music lane. The music lane is cut by Scene Stop, leaving a channel and the Target handover, and a Routed Tab is independent of the Scene lifecycle by definition.

## Consequences

- Under the Local Target a Routed Tab's audio trails its video by the capture and Web Audio scheduling delay, on the order of tens of milliseconds, which is acceptable for ambience and music and is the same order as the Local sink's jitter lead. A tab that is not routed is unaffected.
- A Routed Tab under Local now honors the Output Device, closing the exception recorded in `CONTEXT.md`; a non-routed tab still plays through the system default.
- A renderer freeze stalls a Routed Tab's audio under Local exactly as it stalls the Local sink; the same health reporting applies so it shows up in `hibiki.log`.
