---
layout: default
title: Home
---

<section class="hero" aria-labelledby="hero-title">
  <div class="hero-copy">
    <h1 id="hero-title">Music, ambience and effects, <em>played into Discord</em> from your own desk.</h1>
    <p class="hero-lede">Hibiki is a free desktop app for Game Masters. Build a scene, join your voice channel, and the table hears the tavern, the storm, and the door slam, <strong>with no slash commands and no hosted bot</strong>.</p>
    <div class="download">
      <a class="download-primary" href="https://github.com/PhyberApex/hibiki/releases/latest" data-umami-event="download" data-umami-event-platform="primary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
        Download Hibiki <span class="download-version" data-release-version>v1.4.0</span>
      </a>
      <ul class="download-platforms">
        <li><a href="https://github.com/PhyberApex/hibiki/releases/latest" data-asset="mac" data-umami-event="download" data-umami-event-platform="mac">macOS .dmg</a></li>
        <li><a href="https://github.com/PhyberApex/hibiki/releases/latest" data-asset="win" data-umami-event="download" data-umami-event-platform="win">Windows installer</a></li>
        <li><a href="https://github.com/PhyberApex/hibiki/releases/latest" data-asset="deb" data-umami-event="download" data-umami-event-platform="deb">Linux .deb</a></li>
        <li><a href="https://github.com/PhyberApex/hibiki/releases">All releases</a></li>
      </ul>
      <p class="download-note">Open source, MIT. You bring your own Discord bot token; nothing runs on anyone else's server.</p>
    </div>
  </div>

  <div class="hero-map">
  <svg class="radii" viewBox="0 0 640 530" role="img" aria-labelledby="radii-title radii-desc">
    <title id="radii-title">Three sound layers around the party</title>
    <desc id="radii-desc">An illustration of three overlapping sound layers drawn as circles on a battle-map grid: Tavern Bard music in amber, Crackling Fireplace ambience in teal, and a Mug Slam effect in rose, with the Hibiki mark where all three overlap. Hibiki mixes all layers into one stream for the whole voice channel.</desc>
    <g class="radius radius-music">
      <circle cx="300" cy="230" r="190"/>
      <circle class="radius-core" cx="300" cy="230"/>
      <text x="300" y="68" text-anchor="middle">Tavern Bard</text>
      <text class="radius-value" x="300" y="88" text-anchor="middle">music · loop · 60</text>
    </g>
    <g class="radius radius-ambience">
      <circle cx="410" cy="320" r="170"/>
      <circle class="radius-core" cx="410" cy="320"/>
      <text x="520" y="474" text-anchor="middle">Crackling Fireplace</text>
      <text class="radius-value" x="520" y="494" text-anchor="middle">ambience · every 0s to 2m · 45</text>
    </g>
    <g class="radius radius-effects">
      <circle cx="226" cy="360" r="118"/>
      <circle class="radius-core" cx="226" cy="360"/>
      <text x="140" y="500" text-anchor="middle">Mug Slam</text>
      <text class="radius-value" x="140" y="520" text-anchor="middle">effect · one shot · 65</text>
    </g>
    <g class="token">
      <circle class="token-shadow" cx="334" cy="306" r="40"/>
      <clipPath id="token-clip"><circle cx="330" cy="300" r="34"/></clipPath>
      <image href="{{ site.baseurl }}/logo.png" x="276" y="256" width="108" height="108" clip-path="url(#token-clip)" preserveAspectRatio="xMidYMid slice"/>
      <circle class="token-ring" cx="330" cy="300" r="36"/>
    </g>
  </svg>
    <p class="radii-caption">Three layers, one mix. Everyone in the voice channel hears the same scene.</p>
  </div>
</section>

<section class="region" id="scenes" aria-labelledby="scenes-title">
  <div class="region-head">
    <h2 id="scenes-title">One scene, three layers, one click.</h2>
    <p>A scene is a soundboard. Press play and the whole thing starts; tap any effect when the moment calls for it.</p>
  </div>
  <div class="board-region">
    <dl class="layers">
      <div class="layer">
        <dt><span class="ring ring-ambience"></span><span>Ambience</span></dt>
        <dd>Loops that run under everything: fire, rain, chatter. Each one can also repeat at a random interval you choose, so the owl hoots when nobody expects it.</dd>
      </div>
      <div class="layer">
        <dt><span class="ring ring-music"></span><span>Music</span></dt>
        <dd>One track at a time, looped or not. Switch to the boss theme and the bard stops mid-verse.</dd>
      </div>
      <div class="layer">
        <dt><span class="ring ring-effects"></span><span>Effects</span></dt>
        <dd>One-shot buttons. Door, mug, sword, scream. Big enough to hit without looking.</dd>
      </div>
      <div class="layer">
        <dt><span class="ring"></span><span>Your own volume</span></dt>
        <dd>Every track has its own level and a master slider sits on top, so the fight can get loud without the rain drowning the players.</dd>
      </div>
    </dl>

    <div>
      <div class="window" aria-label="Illustration of the Scenes tab showing the Cozy Tavern scene">
        <div class="win-side" aria-hidden="true">
          <div class="win-guild"><span class="win-live"></span>The Lantern Table</div>
          <div class="win-tab" aria-current="page">Scenes</div>
          <div class="win-tab">Browser</div>
          <div class="win-tab">Media</div>
          <div class="win-tab">Settings</div>
        </div>
        <div class="win-view" aria-hidden="true">
          <div class="win-title"><h3>Cozy Tavern</h3><span>2 ambience · 1 music · 2 effects</span></div>
          <div class="win-bar">
            <span class="win-slider" style="--v: 72%; --s: var(--music)"></span>
            <span class="win-btn win-btn-ghost">Stop</span>
            <span class="win-btn">Play scene</span>
          </div>
          <p class="win-now">Now playing: Tavern Bard · Crackling Fireplace, Tavern Chatter</p>

          <div class="win-section" style="--sec: var(--ambience)">
            <div class="win-section-title">Ambience <span class="win-add">Add ambience…</span></div>
            <div class="win-card is-playing">
              <div class="win-row"><span class="win-name">Crackling Fireplace</span><span class="win-slider" style="--v: 45%; --s: var(--ambience); width: 5rem"></span><span class="win-toggle on"></span><span class="win-x">×</span></div>
              <div class="win-repeat">Repeat every <b>0s</b> to <b>2m</b></div>
            </div>
            <div class="win-card is-playing">
              <div class="win-row"><span class="win-name">Tavern Chatter</span><span class="win-slider" style="--v: 30%; --s: var(--ambience); width: 5rem"></span><span class="win-toggle on"></span><span class="win-x">×</span></div>
              <div class="win-repeat">Repeat every <b>0s</b> to <b>0s</b></div>
            </div>
          </div>

          <div class="win-section" style="--sec: var(--music)">
            <div class="win-section-title">Music <span class="win-add">Add music…</span></div>
            <div class="win-card is-playing">
              <div class="win-row"><span class="win-name">Tavern Bard</span><span class="win-icon win-icon-active"><svg viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" fill="currentColor"/></svg></span><span class="win-slider" style="--v: 60%; --s: var(--music); width: 5rem"></span><span class="win-toggle on"></span><span class="win-x">×</span></div>
            </div>
          </div>

          <div class="win-section" style="--sec: var(--effects)">
            <div class="win-section-title">Effects <span class="win-add">Add effect…</span></div>
            <div class="win-effects">
              <div class="win-effect is-hit">Tavern Door <span class="win-x">×</span></div>
              <div class="win-effect">Mug Slam <span class="win-x">×</span></div>
            </div>
          </div>
        </div>
      </div>
      <p class="window-caption">Illustration of the Scenes tab. Cozy Tavern is one of the free scene packs.</p>
    </div>
  </div>
</section>

<section class="region" id="shots" aria-labelledby="shots-title">
  <div class="region-head">
    <h2 id="shots-title">The real thing.</h2>
    <p>Screenshots of the current release, captured straight from the app.</p>
  </div>
  <div class="shots">
    <figure class="shot">
      <img src="{{ site.baseurl }}/assets/screenshots/scene-editor.png" alt="The Cozy Tavern scene: two ambience loops, one repeating every 30 seconds to 2 minutes, two music tracks, and four effect buttons" width="1440" height="900" loading="lazy">
      <figcaption>A scene. Ambience on top, music in the middle, effects along the bottom.</figcaption>
    </figure>
    <figure class="shot">
      <img src="{{ site.baseurl }}/assets/screenshots/media.png" alt="The sound library with tagged music files and a get started checklist" width="1440" height="900" loading="lazy">
      <figcaption>The sound library. Your files, your tags, nothing uploaded anywhere.</figcaption>
    </figure>
  </div>
</section>

<section class="region" id="legend" aria-labelledby="legend-title">
  <div class="region-head">
    <h2 id="legend-title">Everything else on the map.</h2>
  </div>
  <ul class="legend">
    <li>
      <span class="legend-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.8 3 2.8 15 0 18"/><path d="M12 3c-2.8 3-2.8 15 0 18"/></svg></span>
      <h3>Browser streaming</h3>
      <p>Open YouTube, Spotify web, or any page in the built-in browser tab and send its audio straight to the channel. Bookmark the sites you keep coming back to.</p>
    </li>
    <li>
      <span class="legend-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8 15v-3"/><path d="M12 16V9"/><path d="M16 15v-4"/></svg></span>
      <h3>Media library</h3>
      <p>Drop in your own mp3, wav, ogg or flac files. Sounds live on your disk and are shared across every scene.</p>
    </li>
    <li>
      <span class="legend-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="m3 15 5-5 4 4 3-3 6 5"/><circle cx="16" cy="8.5" r="1.5"/></svg></span>
      <h3>Vision to Vibe</h3>
      <p>Opt in, drop a battle map or mood board into a scene, and get Music and Ambience suggestions from your own tagged library. Works with Claude or any OpenAI-compatible endpoint, including local Ollama. Images are never stored.</p>
    </li>
    <li>
      <span class="legend-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M7 7h.01"/><path d="M7 17h.01"/></svg></span>
      <h3>One channel per server</h3>
      <p>Run the bot in several Discord servers at once. Each one keeps its own voice connection, playback and volumes.</p>
    </li>
    <li>
      <span class="legend-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3l14 8-6 2-3 6z"/></svg></span>
      <h3>App-only control</h3>
      <p>No slash commands, no prefix, nothing for players to type. The desktop window is the whole interface.</p>
    </li>
    <li>
      <span class="legend-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/><circle cx="12" cy="12" r="4"/></svg></span>
      <h3>Share scenes</h3>
      <p>Export a scene with its audio as a <code>.hibiki.zip</code>, or publish a reference recipe to the <a href="{{ site.baseurl }}/scene-sharing">community registry</a> and browse it from inside the app.</p>
    </li>
  </ul>
</section>

<section class="region" id="setup" aria-labelledby="setup-title">
  <div class="region-head">
    <h2 id="setup-title">Three steps to a bot in your server.</h2>
    <p>Hibiki talks to Discord through a bot you own. Making one takes a few minutes and you only do it once.</p>
  </div>
  <div class="setup-region">
    <ol class="steps">
      <li>
        <h3>Create the application and copy its token</h3>
        <p>Go to the <a href="https://discord.com/developers/applications">Discord Developer Portal</a>, click <strong>New Application</strong> and name it (Hibiki works). Open <strong>Bot</strong> in the sidebar, then under <strong>Token</strong> click <strong>Reset Token</strong> and copy it. Treat it like a password.</p>
      </li>
      <li>
        <h3>Invite the bot to your server</h3>
        <p>Open <strong>OAuth2</strong>, then <strong>URL Generator</strong>. Under Scopes tick <strong>bot</strong>. Under Bot Permissions tick:</p>
        <p><span class="perm">View Channels</span><span class="perm">Connect</span><span class="perm">Speak</span><span class="perm">Move Members</span></p>
        <p>Copy the generated URL, open it, pick your server and authorize. The bot appears in the member list, offline until Hibiki runs.</p>
      </li>
      <li>
        <h3>Paste the token into Hibiki</h3>
        <p>Start Hibiki, open <strong>Settings</strong> and paste the token. Pick a server and a voice channel from the sidebar, then play a scene. If you prefer env vars, <code>DISCORD_TOKEN</code> in a <code>.env</code> file works too.</p>
      </li>
    </ol>

    <aside class="aside">
      <div>
        <h3>The fast version</h3>
        <p>Run from source with Node.js 24 and pnpm. No ffmpeg needed.</p>
<pre><code>git clone https://github.com/PhyberApex/hibiki.git
cd hibiki
corepack enable &amp;&amp; pnpm install
<span class="c"># optional: put DISCORD_TOKEN in .env</span>
cp .env.example .env
pnpm dev</code></pre>
      </div>
      <div class="note">
        <h3>On macOS</h3>
        <p>The app is not code-signed, so macOS quarantines it on first launch. Clear the flag once:</p>
        <p><code>xattr -cr /Applications/Hibiki.app</code></p>
        <p>Or right-click the app, choose <strong>Open</strong>, and confirm.</p>
      </div>
    </aside>
  </div>
</section>

<section class="region" id="faq" aria-labelledby="faq-title">
  <div class="region-head">
    <h2 id="faq-title">Questions GMs ask first.</h2>
  </div>
  <dl class="layers faq">
    <div class="layer">
      <dt><span class="ring ring-effects"></span><span>Why not Discord's own soundboard?</span></dt>
      <dd>Discord's soundboard plays short clips, one at a time, with no loops and no layering. Hibiki runs a whole session: music, several ambience loops, and effects at once, mixed into one stream, and the entire scene switches with one click.</dd>
    </div>
    <div class="layer">
      <dt><span class="ring ring-ambience"></span><span>Does anything run on a server?</span></dt>
      <dd>No. The bot lives inside the app on your machine with a token you create. Nothing hosted, nothing metered, no account with us.</dd>
    </div>
    <div class="layer">
      <dt><span class="ring ring-music"></span><span>Do my players install anything?</span></dt>
      <dd>No. Only the Game Master runs Hibiki. Players sit in the voice channel and hear the mix.</dd>
    </div>
    <div class="layer">
      <dt><span class="ring"></span><span>How is it different from Kenku FM or Syrinscape?</span></dt>
      <dd>Read the <a href="{{ site.baseurl }}/compare">honest comparison</a>, including when you should pick one of those instead.</dd>
    </div>
  </dl>
</section>

<section class="region" id="packs" aria-labelledby="packs-title">
  <div class="region-head">
    <h2 id="packs-title">Start with a pack, not an empty board.</h2>
    <p>Eight ready-made scenes with bundled public-domain audio. Import the zip, press play, run the session.</p>
  </div>
  <ul class="packs">
    <li><a href="https://github.com/PhyberApex/hibiki/blob/main/registry/scenes/PhyberApex/cozy-tavern.json">Cozy Tavern</a><span class="counts"><span class="counts-ambience"><span class="ring ring-ambience"></span>2</span><span class="counts-music"><span class="ring ring-music"></span>1</span><span class="counts-effects"><span class="ring ring-effects"></span>2</span></span><small>Fire, chatter, a bard in the corner.</small></li>
    <li><a href="https://github.com/PhyberApex/hibiki/blob/main/registry/scenes/PhyberApex/forest-trail.json">Deep Forest Trail</a><span class="counts"><span class="counts-ambience"><span class="ring ring-ambience"></span>3</span><span class="counts-music"><span class="ring ring-music"></span>1</span><span class="counts-effects"><span class="ring ring-effects"></span>3</span></span><small>Birdsong, wind in the canopy, something in the undergrowth.</small></li>
    <li><a href="https://github.com/PhyberApex/hibiki/blob/main/registry/scenes/PhyberApex/dungeon-crawl.json">Dungeon Crawl</a><span class="counts"><span class="counts-ambience"><span class="ring ring-ambience"></span>3</span><span class="counts-music"><span class="ring ring-music"></span>1</span><span class="counts-effects"><span class="ring ring-effects"></span>3</span></span><small>Dripping stone, distant rumbles, a door that should have stayed shut.</small></li>
    <li><a href="https://github.com/PhyberApex/hibiki/blob/main/registry/scenes/PhyberApex/battlefield-clash.json">Battlefield Clash</a><span class="counts"><span class="counts-ambience"><span class="ring ring-ambience"></span>1</span><span class="counts-music"><span class="ring ring-music"></span>2</span><span class="counts-effects"><span class="ring ring-effects"></span>5</span></span><small>Driving battle music, war horns, a boss theme for the big bad.</small></li>
    <li><a href="https://github.com/PhyberApex/hibiki/blob/main/registry/scenes/PhyberApex/stormy-night-inn.json">Stormy Night at the Inn</a><span class="counts"><span class="counts-ambience"><span class="ring ring-ambience"></span>3</span><span class="counts-music"><span class="ring ring-music"></span>1</span><span class="counts-effects"><span class="ring ring-effects"></span>3</span></span><small>Rain on the shutters, thunder, a long rest.</small></li>
    <li><a href="https://github.com/PhyberApex/hibiki/blob/main/registry/scenes/PhyberApex/haunted-crypt.json">Haunted Crypt</a><span class="counts"><span class="counts-ambience"><span class="ring ring-ambience"></span>3</span><span class="counts-music"><span class="ring ring-music"></span>1</span><span class="counts-effects"><span class="ring ring-effects"></span>4</span></span><small>Dungeon-synth dread, whispers, a sarcophagus lid.</small></li>
    <li><a href="https://github.com/PhyberApex/hibiki/blob/main/registry/scenes/PhyberApex/high-seas-voyage.json">High Seas Voyage</a><span class="counts"><span class="counts-ambience"><span class="ring ring-ambience"></span>3</span><span class="counts-music"><span class="ring ring-music"></span>2</span><span class="counts-effects"><span class="ring ring-effects"></span>3</span></span><small>Creaking hull, gulls, cannon fire.</small></li>
    <li><a href="https://github.com/PhyberApex/hibiki/blob/main/registry/scenes/PhyberApex/market-day.json">Market Day</a><span class="counts"><span class="counts-ambience"><span class="ring ring-ambience"></span>3</span><span class="counts-music"><span class="ring ring-music"></span>1</span><span class="counts-effects"><span class="ring ring-effects"></span>3</span></span><small>Hawkers, coins, a town square at noon.</small></li>
  </ul>
  <div class="packs-actions">
    <a class="btn-ink" href="https://github.com/PhyberApex/hibiki-scene-packs/releases/latest"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>Get the scene packs</a>
    <a href="{{ site.baseurl }}/scene-sharing">How sharing and the registry work</a>
  </div>
</section>
