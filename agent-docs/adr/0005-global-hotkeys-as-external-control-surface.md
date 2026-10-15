# 0005. Global hotkeys are the external control surface

## Status

Accepted

## Context

Issue #510 asks for Stream Deck compatibility: a GM running a session has eyes on the table or the VTT, and controlling Scenes by mouse is too slow. #410 (effect hotkeys with global shortcuts) had been declined as too power-user; a direct user request reopened the question with the whole scope (Scenes and Effects, play and stop).

A Stream Deck, and every comparable device or macro tool, can reach a desktop app in three ways: by emulating a keystroke (needs a system-wide key grab in the app), by opening a URL (needs an OS-registered protocol handler such as `hibiki://`), or through a dedicated device plugin. Most of Hibiki's users are on Windows; the maintainer develops on Linux under Wayland.

Playback today is orchestrated entirely inside `frontend/src/views/SceneView.vue`: only the mounted view knows how to play a Scene (iterate its items, apply master volume, run the Scene Crossfade, track Effect Instances). An external trigger arrives in the main process while the renderer may be on any route.

The domain vocabulary this ADR relies on (**Hotkey**, **Scene Hotkey**, **Effect Hotkey**, **Stop Hotkey**, **Output Target**, **Playing Scene**) is defined in `CONTEXT.md`.

## Decision

- **Global hotkeys via Electron `globalShortcut`, not deep links.** The Stream Deck "Hotkey" action is the path every soundboard and OBS tutorial already teaches, and it also covers macro keyboards, foot pedals and AutoHotkey-style tools. Deep links would work on Windows too (`setAsDefaultProtocolClient` writes the handler at runtime), but they need a single-instance lock and `second-instance` plumbing, can raise or flash the window on open, and require the GM to copy opaque Scene ids into the Deck. Hotkeys fire without touching focus and are bound by pressing the key in Hibiki.
- **Accepted cost: no Wayland.** Electron cannot grab keys under Wayland. Registration failure (there, or because another app owns the key) is surfaced at bind time, at startup as one grouped warning, and in Settings → Diagnostics, and is always logged at `warn`. Deep links remain a possible later addition for environments without global key grabs, not a replacement.
- **Hotkeys address the active Output Target.** A binding stores no Target. The GM's Deck button means "do this at my table", and the table is whichever Target is active (ADR-0004). Under a Discord Target without a voice connection the action is refused with a toast and an `info` log line; nothing auto-joins and nothing falls back to the speakers.
- **Scene Hotkeys are global, Effect Hotkeys are scoped to the Playing Scene.** This lets every Scene reuse the same few keys (for example `F13`–`F16`) for its own Effects, so one Deck page serves the whole campaign. The Playing Scene, not the open Scene, is the anchor, because the GM may have navigated away.
- **Pressing a Scene Hotkey toggles.** It plays the Scene (a Scene Crossfade if another Scene is playing) or stops it if that Scene is already playing. A separate Stop Hotkey stops the Playing Scene from anywhere.
- **In-app uniqueness is enforced before asking the OS.** Rejected at bind time, naming the current owner: the same key on two Scenes, on two Effects of one Scene, or on an Effect and any Scene or Stop Hotkey. Reuse of an Effect key across Scenes is allowed by design.
- **Any accelerator is bindable; the recorder steers.** The key recorder recommends `F13`–`F24` (no physical key, unused by other apps, native to Stream Deck) or a modifier combination, and warns on bare letters and digits that would be stolen from the VTT.
- **Bindings are personal.** Stored on the Scene and its Effect items in `scenes.json`, stripped on `.hibiki.zip` export and import, and absent from Registry bundles. Importing someone else's key layout would grab keys on the GM's machine without consent.
- **A global enable toggle.** "Enable global hotkeys" in Settings registers or releases every key without unbinding, for a GM who needs the keys back temporarily (for example while streaming through OBS).
- **The main process only registers and forwards.** It registers accelerators on `whenReady` after Scenes load, re-diffs on every Scene save and Settings change, releases all on `will-quit`, and forwards each fire to the renderer over IPC. Scene orchestration moves out of `SceneView.vue` into an app-lifetime store so a hotkey can play a Scene from any route; that extraction is a shared prerequisite with #511 and lands as its own stacked issue first. Hotkeys never navigate the router or raise the window.
- **Feedback needs an app-level toast.** None exists; `SoundListManage.vue` has a private one. A shared toast store and component in `App.vue` is introduced with this feature, since the startup registration report fires before any view is chosen.
- **Logging.** Every register and release at `info` with action and key; every fire at `info` with key, action, Scene id, active Target and outcome; every refusal at `warn`. "Pressed the button, nothing happened" must be diagnosable from `hibiki.log` alone.

## Consequences

- GMs build Deck profiles around key layouts, so the binding model (global Scene keys, Playing-Scene-scoped Effect keys, toggle semantics) is costly to change once shipped.
- Linux GMs on Wayland get no hotkeys and are told why. X11, Windows and macOS work; macOS may prompt for Accessibility permission.
- Hibiki must already be running; a hotkey cannot launch it. Acceptable for an app that is open for the whole session.
- Scene orchestration leaves the view. This is the same refactor #511 needs and is sequenced ahead of both features.
- `scenes.json` gains optional hotkey fields on Scenes and Effect items; export/import and the Registry installer learn to strip them.
- Extending the action vocabulary later (next/previous Scene, master volume steps, stop all Effects) only adds bindings; the registration, scoping and feedback machinery is unchanged.
