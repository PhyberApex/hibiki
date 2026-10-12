# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Dungeons & Dragons and other TTRPG Game Masters who run sessions over Discord voice. Mid-game they switch scenes, trigger one-shot effects, and nudge ambience while also running the table, so the app is operated with one hand and half their attention. A secondary audience is any Discord server owner who wants voice-channel audio without slash commands.

The site's visitor is a GM who has not installed Hibiki yet (found the repo, a scene pack, or a friend's recommendation) and needs to decide whether to download it and then get the Discord bot wired up.

## Product Purpose

Hibiki (響, "echo") is a free, open-source Electron desktop app that plays music, ambience loops, and sound effects into a Discord voice channel. The GM builds Scenes (soundboards) in a desktop UI and plays them at the table. Success: a GM downloads it, creates a bot in a few minutes, installs a scene pack, and is playing a tavern scene on the first evening.

## Positioning

A desktop companion, not a hosted bot: the audio engine runs on the GM's own machine with their own Discord bot token, so there is no shared service, no premium tier, and no command prefix. Scenes layer three categories at once (music, ambience with random-interval repeats, one-shot effects) and are shareable as `.hibiki.zip` archives or through a community registry of reference-only recipes. The built-in Browser tab streams any web page's audio (YouTube, Spotify web) into the channel.

## Operating Context

- GM has Discord open, a virtual tabletop or notes, and Hibiki on a second monitor or behind the VTT.
- First run requires creating a Discord application and bot in the Discord Developer Portal, inviting it with View Channels, Connect, Speak, Move Members, and pasting the token into Hibiki's Settings (or `DISCORD_TOKEN`).
- Sound files live on disk in the user data directory (`music/`, `effects/`, `ambience/`); scenes in `scenes.json`.
- Ready-made scene packs with bundled CC0 audio live in the `hibiki-scene-packs` repo; the registry in `registry/` of this repo lists reference-only scenes with source links.

## Capabilities and Constraints

- Scenes: music tracks (volume, loop), ambience loops (random interval repeats, enabled toggle), one-shot effects; play whole scene or individual tracks; master volume.
- Browser streaming of any URL with bookmarks.
- Media library: upload and manage mp3/wav/ogg/flac (m4a via renderer fallback).
- Vision to Vibe (opt-in): analyze a battle map or mood board image with Claude or an OpenAI-compatible endpoint and suggest Music/Ambience from the GM's own tagged library. Images are never stored.
- Multi-guild: one voice channel per Discord server, independent state.
- App-only control: no slash or prefix commands.
- Platforms: macOS (`.dmg`, arm64 zip), Windows, Linux (`.deb`, zip). Latest release v1.4.0 (2026-10-11). macOS build is not code-signed; users run `xattr -cr /Applications/Hibiki.app`.
- Site constraints: Jekyll on GitHub Pages served from `docs/` at `https://phyberapex.github.io/hibiki/` (baseurl `/hibiki`). No build step beyond Jekyll; plain HTML/CSS, no JS framework.
- Pages: landing (`index.md`) and Scene Sharing guide (`scene-sharing.md`). All existing content is retained (confirmed by user).

## Brand Commitments

- Name: Hibiki (響). Tagline in use: "Echoes of Adventure."
- Mascot: the hooded bard robot with a lute, in two confirmed assets: `docs/logo.png` (819x819, dark ground with HIBIKI lettering) and `docs/banner.png` (1536x1024, campfire scene with castle, dice, spellbook). The user confirmed that the mascot art and the name are the only untouchable elements; colors and typography of the site are open (the app itself uses a dark warm ground with amber accent and Plus Jakarta Sans, which the site may echo but need not).
- Tone: warm, crafted, inviting; a companion to storytelling, not a studio tool. Anti-references: sterile dashboards, neon gamer, clinical minimalism.
- License: MIT. Author: PhyberApex.

## Evidence on Hand

- Real scene content: eight registry scenes in `registry/scenes/PhyberApex/` (Cozy Tavern, Deep Forest Trail, Dungeon Crawl, Battlefield Clash, Stormy Night at the Inn, Haunted Crypt, High Seas Voyage, Market Day) with real track names, volumes and CC0 sources.
- Real app UI structure: `frontend/src/views/SceneView.vue` and `frontend/src/assets/base.css` (category colors: music amber `#f59e0b`, ambience teal `#2dd4bf`, effects rose `#fb7185`).
- No app screenshots exist; the user chose an authored HTML/CSS mock of the scene board (labeled as an illustration) over screenshots.
- No testimonials, user counts, or press. Do not fabricate any.

## Product Principles

1. Session-ready: the visitor should know what Hibiki is, see it working, and find the download within one viewport.
2. Prove with the real thing: real scene names, real track lists, real setup steps. No invented claims.
3. Setup is part of the product: the Discord bot walkthrough is the biggest friction, so the site must make it feel short and doable.
4. Warm and crafted, never gimmicky: atmosphere over ornament.
5. Keep it static and cheap: Jekyll-renderable, no runtime framework, fast on GitHub Pages.
