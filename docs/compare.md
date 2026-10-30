---
layout: default
title: Hibiki vs Kenku FM and other options
description: An honest comparison of Hibiki with Kenku FM, Discord's built-in soundboard and Syrinscape for Game Masters who want music, ambience and effects in a Discord voice channel.
---

<div class="read-layout">
<nav class="toc" aria-label="On this page">
  <span class="map-label"><span class="ring ring-music"></span>On this page</span>
  <ol>
      <li><a href="#table">Side by side</a></li>
      <li><a href="#notes">Notes on each column</a></li>
      <li><a href="#else">When to pick something else</a></li>
      <li><a href="#others">Other tools you may have heard of</a></li>
      <li><a href="#sources">Sources</a></li>
  </ol>
</nav>
<article class="prose" markdown="1">

# Hibiki vs Kenku FM and other options

There are a few good ways to get sound into a Discord voice channel for a tabletop session. This page compares Hibiki with the three you are most likely to run into: Kenku FM, Discord's own soundboard, and Syrinscape. The goal is to help you pick the right one for your table, not to win an argument.
{: .lede}

Everything here was checked in October 2026 against the sources listed at the bottom. Anything marked *unverified* could not be confirmed from an official page and should be treated as a best guess.


## Side by side
{: #table}

| | Hibiki | Kenku FM | Discord soundboard | Syrinscape |
|---|---|---|---|---|
| Price | Free | Free | Free (Nitro for cross-server sounds) | Free content; SuperSyrin US$12.99/month[^syrin-price] |
| Open source | Yes, MIT | Yes, GPL-3.0 | No | No |
| Needs your own bot token | Yes | Yes | No | No bot at all |
| Runs locally or hosted | Local desktop app, your files on your disk | Local desktop app, your files on your disk | Built into Discord | Hosted library; player app or web player, players listen via a link |
| Scenes / soundboards | Scenes with music, ambience and effects layers | Playlists plus soundboards | Flat list of server sounds | SoundSets with moods and one-shots |
| Ambience with random interval repeats | Yes, per ambience item | No[^kenku-random] | No | Yes, randomised elements inside SoundSets[^syrin-random] |
| Stream a browser tab to Discord | Yes, built-in browser | Yes, built-in browser (Spotify not on Linux) | No | No |
| Your own audio files | Yes (mp3, wav, ogg, flac) | Yes (local files) | Yes, uploads only | Limited[^syrin-own] |
| Max clip length | No cap | No cap | 5.2 seconds, 512 KB, MP3 or OGG | No cap on their content |
| Platforms | macOS, Windows, Linux | macOS, Windows, Linux (x64 and arm64) | Discord desktop, browser and mobile | Web player, desktop and mobile apps[^syrin-platforms] |
| Actively maintained | Yes (v1.4.0, regular releases) | Slow; last release March 2026, bug fixes only | Yes, by Discord | Yes, commercial product |
| Image to music suggestions | Yes, opt-in Vision to Vibe | No | No | No |


## Notes on each column
{: #notes}

### Hibiki

Hibiki is a free, MIT-licensed Electron app. You create a Discord bot in the developer portal, paste its token into Settings, and the bot joins a voice channel in your server. Scenes have three layers: music (one track at a time, optionally looped), ambience (loops that can also repeat at a random interval you set), and effects (one-shot buttons). The Browser tab opens any website in an embedded browser and streams its audio to the channel. Scenes export as `.hibiki.zip` bundles, and a public registry plus free CC0 scene packs give you a starting point. Vision to Vibe is an opt-in feature that sends a battle map or mood board to Claude or any OpenAI-compatible endpoint (including a local Ollama) and suggests music and ambience from your own tagged library.

Hibiki is a young project with one main maintainer. It is not code-signed on macOS, so you clear the quarantine flag once on first launch. If you are switching over from Kenku FM, the [Coming from Kenku FM]({{ site.baseurl }}/kenku) page covers reusing your bot and moving your library.

### Kenku FM

Kenku FM is the closest sibling to Hibiki. It is made by the Owlbear Rodeo team, is GPL-3.0 licensed, and works the same way: you bring your own bot token, run a desktop app, and it mixes local files and a built-in browser into a Discord voice call. Its player has playlists (with shuffle and repeat) and soundboards where each sound has its own loop, volume, fade in and fade out settings. Extras that Hibiki does not have: an Elgato Stream Deck plugin driven by a local HTTP remote, mixing in OS audio inputs, sending output to several Discord servers at the same time, and a local output for streaming software. It ships Widevine DRM support so Spotify works on Windows and macOS (Linux cannot do Spotify because of Widevine's verified media path rules).

On maintenance: the latest stable release is v1.5.5 from 4 March 2026, with a parallel v1.6.7-experimental track. That release added Discord's DAVE end-to-end encryption protocol, which matters because Discord has been rolling DAVE out to voice. The package pins Electron 37.6.0 (the castLabs build) and discord.js 14.25.1. The repository is not archived, but the README states the project accepts pull requests for bug fixes only, no new features. As of October 2026 there are 74 open issues, and the Stream Deck plugin repository was last pushed in 2022.

### Discord soundboard

Discord's soundboard is a reaction feature, not a music player, and Discord describes it that way. Clips are capped at 5.2 seconds and 512 KB (MP3 or OGG). A server gets 8 preloaded slots, rising to 24, 36 and 48 slots at boost tiers 1, 2 and 3. Sounds uploaded to a server are usable there by everyone with the Use Soundboard permission; Nitro subscribers can use those sounds in any server. Uploading is desktop or browser only, playing works on desktop and mobile. There is no looping, no layering and no music.

### Syrinscape

Syrinscape is the established commercial option. It is a curated, professionally produced library of SoundSets (moods, loops and one-shots) rather than a tool for your own files. The free tier includes a generous library in the Nova player and free content in the web, Fantasy and Sci-Fi players; SuperSyrin unlocks everything for US$12.99 a month (first month US$6.50 at the time of writing). For online play you share a listener link and players open it in a browser with no account. There is no official Discord integration; GMs who want the audio in the voice channel itself route it through a virtual cable, a second Discord client, or a bot such as Kenku FM.


## When to pick something else
{: #else}

**Pick Kenku FM if** you already use a Stream Deck, need to send the same audio to several Discord servers at once, need to mix in a microphone or another OS input, or want DRM-protected Spotify in the built-in browser on Windows or macOS. Kenku is also the more battle-tested of the two bot-based apps and has been around since 2021. The trade-offs are a slow release cadence and a bug-fix-only policy, so if something you want is missing it is unlikely to arrive.

**Pick the Discord soundboard if** all you want is a handful of short stingers (a door, a sword hit, a dramatic sting) and you do not want to set up a bot. It is zero friction, works on mobile, and your players can trigger sounds too. It is simply not built for background music or ambience.

**Pick Syrinscape if** you would rather pay a subscription than build a library. Its SoundSets are deep, layered and designed for specific published adventures, and you get a complete tavern or dragon fight out of the box. If your players are happy opening a listener link next to Discord, you never need a bot. If you insist on the audio inside the voice channel, pair Syrinscape with Hibiki or Kenku through a virtual audio cable.

**Pick Hibiki if** you want to stay free and local, you like building scenes from your own files or from the free scene packs, you want ambience that repeats at random intervals instead of looping flat, and you want the whole thing driven from one desktop window with no commands for players to learn.


## Other tools you may have heard of
{: #others}

- **Tabletop Audio** is a free, ad-free, donation-supported library of ten-minute ambience and music tracks played in the browser, with a SoundPad mixer and Patreon extras. It has no Discord integration; route it through Hibiki's or Kenku's browser tab.
- **Pocket Bard** is an adaptive music and ambience app for iOS, Android and desktop with free Fantasy Essentials and Modern Horror collections and a subscription at US$6.99 a month or US$49.99 a year. Its site describes no Discord integration.
- **Rythm** was shut down by a YouTube cease-and-desist in September 2021 and relaunched in 2024 as a licensed Discord Activity with a US$4.99 premium tier. It plays a licensed catalogue, not your files, and its 2026 status beyond that relaunch is *unverified*.
- **FredBoat** still has public documentation describing YouTube and SoundCloud playback, but at the time of writing its website returned an error and its GitHub repository could not be found, so its current status is *unverified*. Treat it as unreliable for a session.
- **Groovy** shut down in August 2021 for the same reason as Rythm.

The general picture for hosted "music bots" has been the same since 2021: YouTube playback by bots is against YouTube's terms, so the surviving bots either went premium with licensed catalogues or dropped YouTube. A local app with your own bot token, like Hibiki or Kenku FM, side-steps that because the audio comes from your machine.


## Sources
{: #sources}

- Kenku FM repository (README, license, contribution policy): <https://github.com/owlbear-rodeo/kenku-fm>
- Kenku FM releases (v1.5.5 and v1.6.7-experimental, 4 March 2026, DAVE support): <https://github.com/owlbear-rodeo/kenku-fm/releases>
- Kenku FM package.json (Electron 37.6.0+wvcus, discord.js 14.25.1): <https://github.com/owlbear-rodeo/kenku-fm/blob/main/package.json>
- Kenku FM open issues: <https://github.com/owlbear-rodeo/kenku-fm/issues>
- Kenku FM player types (soundboard loop, volume, fade in and fade out; playlist shuffle and repeat): <https://github.com/owlbear-rodeo/kenku-fm/blob/main/src/types/player.ts>
- Kenku FM Stream Deck plugin: <https://github.com/owlbear-rodeo/kenku-fm-stream-deck>
- Discord Soundboard help article (slots per boost tier, permissions, desktop and mobile): <https://support.discord.com/hc/en-us/articles/12612888127767>
- Discord developer docs, Soundboard resource (5.2 seconds, 512 KB, MP3 or OGG, Nitro cross-server use): <https://docs.discord.com/developers/resources/soundboard>
- Syrinscape get started page (SuperSyrin US$12.99/month, first month US$6.50, free content, Share Audio listener link): <https://syrinscape.com/get-started/>
- Syrinscape forum thread on routing audio to Discord via a bot: <https://forum.syrinscape.com/t/discord-bot-for-syrinscape-to-get-stereo-sound/11235>
- Tabletop Audio: <https://tabletopaudio.com/> and SoundPad: <https://tabletopaudio.com/soundpad.html>
- Pocket Bard (pricing, platforms): <https://pocketbard.app/>
- Rythm relaunch as a Discord Activity (June 2024): <https://alternativeto.net/news/2024/6/rythm-returns-popular-discord-music-bot-relaunches-as-activity-app-with-new-features/>
- Rythm shutdown in 2021: <https://www.nme.com/news/discord-music-bot-rythm-follows-groovy-into-the-void-after-cease-and-desist-3045407>
- FredBoat documentation: <https://fredboat-docs.readthedocs.io/>
- Hibiki README and releases: <https://github.com/PhyberApex/hibiki>

[^syrin-price]: Monthly price from the Syrinscape get started page in October 2026. The page says "or the best deal available for your account", so regional or promotional pricing may differ. Annual pricing is not listed there and is *unverified*.

[^kenku-random]: Kenku FM's soundboard sound model has loop, volume, fade in and fade out fields but no random-interval repeat setting. Its remote API can play a random sound from a soundboard on demand, which is a different feature.

[^syrin-random]: Syrinscape SoundSets are built from randomised one-shot elements layered over loops. This is their long-standing design; the specific randomisation controls were not checked against an official page and are *unverified*.

[^syrin-own]: Syrinscape's SoundSet Creator for custom content is tied to the subscription, and forum threads request the ability to add your own sounds. Exact current limits on importing your own files are *unverified*.

[^syrin-platforms]: The get started page names the Nova player, a web player and the Fantasy and Sci-Fi players. The exact list of supported operating systems and mobile stores was not checked and is *unverified*.

</article>
</div>
