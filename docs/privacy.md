---
layout: default
title: Privacy
description: What this website and the Hibiki app do and do not collect.
---

<div class="read-layout">
<article class="prose" markdown="1">

# Privacy

## This website

This site uses a self-hosted instance of [Umami](https://umami.is), a privacy-focused analytics tool, to count page views and download clicks. It runs on infrastructure operated by the site owner, not by a third party.

- No cookies are set and nothing is stored in your browser.
- No personal data is collected. IP addresses are not stored; Umami derives a temporary, salted hash that cannot be linked back to you and discards it daily.
- Collected data: page URL, referrer, browser and operating system family, screen size, country, and clicks on the download buttons.
- The data is used only to understand which pages and channels bring people to Hibiki.

Because no personal data is processed and no cookies are used, no consent banner is shown. If you still prefer not to be counted, most ad or tracker blockers will stop the script, and the site works without it.

The site is hosted on [GitHub Pages](https://docs.github.com/en/pages). GitHub may log requests according to its own [privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## The Hibiki app

The desktop app has no account. It talks to:

- **Discord**, through the bot token you create, to join voice channels and stream audio.
- **GitHub**, to fetch the public scene registry and community scenes when you open the Scenes browser.
- **A Vision Provider you choose** (Claude, or any OpenAI-compatible endpoint including local servers), only if you opt into Vision to Vibe in Settings. The image you select is sent once for analysis and never stored by Hibiki.
- **Any website you open in the Browser tab**, which is a normal embedded browser and is subject to that site's own policies.
- **The same self-hosted Umami instance as this website**, only if you switch on Usage Stats (below).

Your configuration, scenes and sound files stay on your computer in the application data folder.

## Usage Stats in the app

Usage Stats are anonymous counts of which features get used, so development can follow what Game Masters actually do. They are **off by default**. Hibiki asks once, with a card on its Welcome screen; "Not now" means it never asks again. You can switch them on or off at any time in **Settings → Usage Stats**, which also shows the list below.

When they are on, the app sends these events, and nothing else, to the self-hosted Umami instance at `analytics.phyberapex.de`:

| Event | When | What it carries |
|---|---|---|
| `app-start` | Once per launch, and once when you switch Usage Stats on | Operating system (`darwin`, `win32`, `linux`), processor architecture, Hibiki version, language (e.g. `en-US`) |
| `scene-play` | A Scene starts (Play, Scene Hotkey, Previous/Next Scene, Scene Crossfade) | Music Mode (`single`, `sequential`, `shuffle`), the number of Music, Ambience and Effect items, the output kind (`discord` or `local`) |
| `target-switch` | You switch between Discord and Local output | The output kind switched to |
| `routed-tab-toggle` | You route a Browser tab into Hibiki or stop routing it | Routed or not, the output kind |
| `hotkey-fired` | A global Hotkey is pressed | Whether it was a Scene, Effect or Action Hotkey (never the key itself) |
| `vision-analyze` | You analyze an image with Vision to Vibe | The Vision Provider kind (`claude` or `openai-compatible`), never the image |
| `registry-install` | You install a Scene from the community Registry | The public Registry entry id (e.g. `battlefield-clash`) |

Every event also carries the name of the screen it happened on (for example `/settings` or `/scenes/:id`, never a Scene's id), the fixed hostname `hibiki-desktop`, and a User-Agent naming the app instead of a browser, for example `Hibiki/1.7.0 (Electron/41.0.0; Linux x86_64)`.

- **No identifier is stored.** Hibiki keeps nothing on your computer that identifies the machine or the install, so switching Usage Stats off leaves nothing to delete. Umami's own daily salted hash (see above) is the only notion of a visitor, so the numbers show active machines per day, not installs.
- **Never sent:** server (guild) or channel names or ids, Scene, sound or Hotkey names, website addresses, images, or anything else you created.
- **Never retried or queued.** A send that fails is dropped; nothing piles up on disk to be sent later.
- **Auditable.** Every event sent is written to the app's log file (**Settings → Diagnostics**).
- **Development and unpackaged builds never send**, and setting the environment variable `HIBIKI_USAGE_STATS=off` stops a packaged build from sending even when the toggle is on.

The list above is the complete set the app's code allows. Adding an event means changing this page in the same release.

## Contact

Questions about this page: open an issue at [github.com/PhyberApex/hibiki/issues](https://github.com/PhyberApex/hibiki/issues).

</article>
</div>
