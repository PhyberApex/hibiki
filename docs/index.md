---
layout: default
title: Discord audio companion bot
---

<section>
  <div class="container">
    <h2>What is Hibiki?</h2>
    <p class="lead">
      Hibiki (響) is a Discord bot that plays music and sound effects in voice channels. Control it with Discord commands or a web dashboard: join/leave, play tracks, trigger effects, manage uploads, and see bot status at a glance.
    </p>
    <p>
      Built with NestJS and Discord.js on the backend and Vue 3 on the frontend. Single Docker image. SQLite is used only for **player snapshots** (so the dashboard shows "last seen" state after restarts) and the **permissions allowlist** (who can use the bot). Sound files live on disk, not in the database.
    </p>
  </div>
</section>

<section>
  <div class="container">
    <h2>Features</h2>
    <div class="features">
      <div class="feature">
        <img src="{{ site.baseurl }}/banner.jpg" alt="Dashboard">
        <h3>Web dashboard</h3>
        <p>Control Center: player state, join/leave, play music or effects, upload and manage sounds. Bot connection status and permissions in one place.</p>
      </div>
      <div class="feature">
        <img src="{{ site.baseurl }}/logo.jpg" alt="Discord">
        <h3>Discord commands</h3>
        <p><code>!join</code>, <code>!leave</code>, <code>!play</code>, <code>!effect</code>, <code>!menu</code> for a button panel. List songs and effects, then play by name or id.</p>
      </div>
      <div class="feature">
        <img src="{{ site.baseurl }}/favicon.jpg" alt="Deploy">
        <h3>One container</h3>
        <p>Single Docker image. Mount a volume for storage; SQLite and uploaded sounds persist. Optional docker-compose for local or server deploy.</p>
      </div>
    </div>
  </div>
</section>

<section>
  <div class="container">
    <h2>Discord bot setup</h2>
    <p class="lead">You need a Discord application and bot token before running Hibiki. Follow these steps once.</p>

    1. **Create an application**
       Go to [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**. Name it (e.g. Hibiki) and create. On the **General Information** page, copy the **Application ID** — this is `DISCORD_CLIENT_ID`.
    2. **Create the bot and get the token**
       In the sidebar, open **Bot** → **Add Bot**. Under **Token**, click **Reset Token** (or View Token), then copy it. This is `DISCORD_TOKEN` — keep it secret. Under **Privileged Gateway Intents**, turn on **Message Content Intent** (required for commands).
    3. **Invite the bot to your server**
       Open **OAuth2** → **URL Generator**. Under Scopes choose **bot**. Under Bot Permissions select: **View Channels**, **Send Messages**, **Read Message History**; for voice you must enable **Connect** (join voice channels) and **Speak** (transmit audio). Optionally **Manage Messages** (for `!delete`). Copy the generated URL, open it in a browser, pick your server, and authorize. The bot will show up in your server (offline until Hibiki is running).
    4. **Set environment variables**
       In the repo root, copy the sample env and add the values you copied:
       ```bash
       cp .env.sample .env
       # Edit .env and set:
       # DISCORD_TOKEN=your_bot_token
       # DISCORD_CLIENT_ID=your_application_id
       ```
    {: .steps}
  </div>
</section>

<section>
  <div class="container">
    <h2>Run Hibiki</h2>
    <p class="lead">After the Discord bot is set up, install dependencies and start the bot and dashboard.</p>
    <p>**Requirements:** Node.js 20+, pnpm (<code>corepack enable</code>), and ffmpeg installed on your system.</p>
    <pre class="code"><code>git clone https://github.com/phyberapex/hibiki.git
cd hibiki
corepack enable && pnpm install
cp .env.sample .env   # set DISCORD_TOKEN and DISCORD_CLIENT_ID
pnpm dev</code></pre>
    <p>Dashboard: [http://localhost:5173](http://localhost:5173) (dev). Check the "Bot connected" indicator; then use the Control Center to join a voice channel and play. You can also use Discord commands (<code>!join</code>, <code>!play</code>, <code>!menu</code>, etc.). Who can use the bot is set in the dashboard under **Permissions** (allowlist of role/user IDs).</p>
    <p>**Docker:** <code>docker compose up -d</code> (after setting <code>.env</code>). Dashboard and API at [http://localhost:3000](http://localhost:3000). Pre-built images: <code>ghcr.io/phyberapex/hibiki:latest</code> (releases) or <code>ghcr.io/phyberapex/hibiki:next</code> (bleeding edge). See the main repo README for all tags.</p>
    <a href="https://github.com/phyberapex/hibiki" class="cta">View on GitHub</a>
  </div>
</section>

<section>
  <div class="container">
    <h2>Known issues</h2>
    <ul>
      <li>**Playback crackling at start:** The first second or so of a track (or effect) can sometimes crackle or pop. This is a known limitation of the current audio pipeline and may be improved in a future release.</li>
    </ul>
  </div>
</section>
