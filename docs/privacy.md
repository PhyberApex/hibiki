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

The desktop app has no telemetry, no analytics, and no account. It talks to:

- **Discord**, through the bot token you create, to join voice channels and stream audio.
- **GitHub**, to fetch the public scene registry and community scenes when you open the Scenes browser.
- **A Vision Provider you choose** (Claude, or any OpenAI-compatible endpoint including local servers), only if you opt into Vision to Vibe in Settings. The image you select is sent once for analysis and never stored by Hibiki.
- **Any website you open in the Browser tab**, which is a normal embedded browser and is subject to that site's own policies.

Your configuration, scenes and sound files stay on your computer in the application data folder.

## Contact

Questions about this page: open an issue at [github.com/PhyberApex/hibiki/issues](https://github.com/PhyberApex/hibiki/issues).

</article>
</div>
