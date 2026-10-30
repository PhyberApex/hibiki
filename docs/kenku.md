---
layout: default
title: Coming from Kenku FM
description: A guide for Kenku FM users trying Hibiki, covering what is the same, what is different, how to move a library over, reusing the same Discord bot, and what to check when the bot joins but nobody hears audio.
---

<div class="read-layout">
<nav class="toc" aria-label="On this page">
  <span class="map-label"><span class="ring ring-music"></span>On this page</span>
  <ol>
      <li><a href="#same">What is the same</a></li>
      <li><a href="#different">What is different</a></li>
      <li><a href="#bot">Reusing your bot</a></li>
      <li><a href="#library">Moving your library</a></li>
      <li><a href="#rebuild">Rebuilding playlists and soundboards as Scenes</a></li>
      <li><a href="#silent">The bot joins but nobody hears anything</a></li>
      <li><a href="#gaps">Known gaps</a></li>
  </ol>
</nav>
<article class="prose" markdown="1">

# Coming from Kenku FM

Kenku FM has been the reference for playing your own audio into a Discord voice channel since 2021, and this page exists because its makers have moved on to Owlbear Rodeo, not because Kenku was bad. If it still works for your table, keep using it. If it stopped working, or you want scenes instead of playlists, here is what changes when you switch.
{: .lede}

Checked in October 2026 against the sources listed on the [comparison page]({{ site.baseurl }}/compare). Kenku FM's latest release is v1.5.5 (4 March 2026) and its repository accepts bug fixes only.


## What is the same
{: #same}

- **Your own bot, your own token.** You create a bot in the Discord developer portal, paste its token into the app, and the bot joins a voice channel in your server. Nothing is hosted and nobody can switch it off.
- **Your own files, on your own disk.** Hibiki plays local audio. Nothing is uploaded anywhere except as the voice stream Discord hears.
- **A built-in browser tab** whose audio can go into the channel, so a web player like Tabletop Audio or the Syrinscape web player works without a virtual cable.
- **Players install nothing.** Only the GM runs the app.
- **Free and open source.** Kenku is GPL-3.0, Hibiki is MIT. Windows, macOS and Linux on both.


## What is different
{: #different}

| | Kenku FM | Hibiki |
|---|---|---|
| Organising unit | Playlists (music) and Soundboards (sounds) | Scenes: one soundboard with a Music list, Ambience loops and Effect buttons, started and stopped as a whole |
| Background loops | Soundboard sound with Loop on | Ambience: loops, and each one can also repeat at a random interval you set (every 0 to 2 minutes, for example) |
| Switching mood mid-session | Stop one thing, start another | Open another Scene and press Play; the old Scene's Music and Ambience fade out while the new one fades in over the Scene fade length |
| Music playback | Playlist with shuffle and repeat | Music Mode per Scene: single track (looped or not), sequential, or shuffle |
| Per-sound settings | Loop, volume, fade in, fade out | Loop and volume per item; fades belong to the Scene (one fade length under **Settings → Scene transitions**), not to individual sounds |
| Global hotkeys | Via the Stream Deck plugin and remote API | Built in: a Hotkey per Scene, plus Stop, Stop all Effects, Volume Up and Down, Previous and Next Scene |
| In-person tables | Local output for streaming software | "Play at the table" plays the same mix through your own speakers with no bot at all |
| Several servers at once | Yes | One Output Target at a time; switching Target stops on the old and restarts the Scene on the new |
| Mixing in a microphone or other OS input | Yes | No |
| Stream Deck plugin, HTTP remote | Yes | No |
| Spotify in the browser tab | Yes on Windows and macOS (Widevine DRM) | Not expected to work: Hibiki uses stock Electron without Widevine, which Spotify's web player requires. Non-DRM sites work |
| Sharing | Nothing built in that we could verify | `.hibiki.zip` export and import of a whole Scene, a public registry browsed from inside the app, and free CC0 [scene packs](https://github.com/PhyberApex/hibiki-scene-packs) |
| Image to music suggestions | No | Opt-in Vision to Vibe, off by default, suggests from your own tagged library |

The short version: if your Kenku setup is "one playlist of music plus a few looping sounds I switch between", that is exactly one Scene per mood in Hibiki, and switching between them becomes one click with a crossfade.


## Reusing your bot
{: #bot}

Keep the same Discord application. There is nothing to recreate.

1. In Hibiki open **Settings** and paste the bot token you already use with Kenku. If you no longer have it, open the [Discord Developer Portal](https://discord.com/developers/applications), pick the application, go to **Bot** and press **Reset Token**. The old token stops working, so update Kenku too if you keep it around.
2. Check the bot's permissions in your server. Hibiki wants **View Channels**, **Connect**, **Speak** and **Move Members**. If your Kenku invite granted less, generate a new invite link under **OAuth2 → URL Generator** with those permissions and open it; re-authorising an existing bot updates its permissions without removing it.
3. Do not run Kenku and Hibiki with the same token at the same time. Two apps logged in as one bot fight over the voice connection, and the result looks like random silence.

The bot shows as offline in your member list until Hibiki is running, same as with Kenku.


## Moving your library
{: #library}

Kenku does not copy audio files; it remembers where they already are on your disk. Hibiki does copy them, into its own storage folder (`music/`, `ambience/` and `effects/` inside the user data directory, or a folder you choose under **Settings → Storage location**). So the move is: find the files Kenku points at, drop them into Hibiki.

1. Make a list of the files Kenku uses. Open each Kenku playlist and soundboard; the track settings show the file path. Most people keep them in one or two folders anyway.
2. In Hibiki open **Media** and drag the files onto the matching panel: music tracks to **Music**, looping sounds to **Ambience**, one-shots to **Effects**. A file can be in more than one category if you need it both as a loop and as a one-shot.
3. Formats: MP3, WAV, FLAC and OGG (Vorbis and Opus) are decoded by Hibiki itself. M4A and AAC still play, through a fallback path in the app window, so they work but cannot be used in every situation the native formats can; converting them to OGG or FLAC once is worth it for anything you use a lot.
4. Optionally tag Music and Ambience files (mood, place, intensity) in the Media view. Tags are free text and power Vision to Vibe later if you ever switch it on; they cost nothing otherwise.

There is no automatic importer for Kenku's playlist and soundboard data yet. If enough people moving over want one, it is a candidate; say so in the [issue tracker](https://github.com/PhyberApex/hibiki/issues).


## Rebuilding playlists and soundboards as Scenes
{: #rebuild}

Think in moods rather than in lists. A Kenku session usually has one music playlist and one soundboard open at a time; each such combination is one Scene.

- **A Kenku playlist** becomes the **Music** list of a Scene. Set the Scene's Music Mode to **sequential** for the Kenku "repeat playlist" behaviour, **shuffle** for Kenku shuffle, or **single** with Loop on for the "one track forever" case.
- **A looping soundboard sound** (fire, rain, tavern chatter) becomes an **Ambience** item. Leave the interval at 0 for a plain loop, or give it a random interval so it stops being a flat loop: an owl every 0 to 2 minutes, distant thunder every 1 to 5.
- **A one-shot soundboard sound** (door, sword, scream) becomes an **Effect** button. Several can overlap, and **Stop all Effects** (also a Hotkey) ends them without touching the Music.
- **Volume**: each item keeps its own level and a master slider sits on top, like Kenku's per-sound volume plus the app volume.
- **Hotkeys**: give each Scene a Hotkey under **Settings → Hotkeys**, plus Previous and Next Scene if you want to walk through the session in order; Scenes are kept in the order you drag them into.

If you only want to try it, install one of the free scene packs from the registry browser in the **Scenes** view first (Cozy Tavern, Forest Trail, Dungeon Crawl, Battlefield Clash and four more). Each is a complete Scene with CC0 audio and shows the three layers working together before you rebuild your own.


## The bot joins but nobody hears anything
{: #silent}

Discord switched voice to its end-to-end encryption protocol (DAVE) in early 2026 and made it mandatory. Audio apps that did not speak it kept joining the channel, kept showing the green speaking ring, and sent audio nobody could decode. Kenku added DAVE support in v1.5.5 on 4 March 2026; the "no audio after joining" reports in its issue tracker from March onward are mostly this. Hibiki's voice stack implements DAVE, and every voice state transition is written to its log.

If you see the symptom with Hibiki, check in this order:

1. **Only one app is logged in as the bot.** Quit Kenku (check the tray; an older Kenku install left running is a common cause of exactly this symptom on the Kenku side too).
2. **The listener's Discord client is current.** DAVE is negotiated per participant; one very old desktop client in the channel can hear nothing while everyone else is fine.
3. **Permissions.** The bot needs Speak in that specific channel; channel overrides can deny what the server role grants.
4. **Master volume and the Scene's own levels** are not at zero, and the Scene is actually playing (the Scenes view shows the Playing Scene).
5. **Read the log.** **Settings → Diagnostics → Copy diagnostics** gives a summary; the full file is `logs/hibiki.log` in the user data directory (the path is shown in Settings). A join that worked logs the voice connection becoming ready and the audio player switching to playing. If you open an [issue](https://github.com/PhyberApex/hibiki/issues), attach that file; it contains no tokens.


## Known gaps
{: #gaps}

Honest list of what Kenku users will miss, so nobody finds out mid-session:

- No Stream Deck plugin and no HTTP remote. Global hotkeys cover the common cases; a Stream Deck can trigger them as keyboard shortcuts.
- No mixing of a microphone or other OS audio input into the stream.
- No simultaneous output to several Discord servers.
- No Widevine, so Spotify's web player and other DRM services are not expected to play in the browser tab.
- No per-sound fade in and fade out; fades are per Scene.
- The macOS build is not code-signed, so the first launch is a right-click, **Open**, confirm.
- One maintainer. Releases are frequent, but the issue tracker is where to check before relying on something.

Everything else, including the comparison with the Discord soundboard and Syrinscape, is on the [comparison page]({{ site.baseurl }}/compare).

</article>
</div>
