export function configuration() {
  return {
    discord: {
      token: process.env.DISCORD_TOKEN ?? '',
      clientId: process.env.DISCORD_CLIENT_ID ?? '',
      defaultGuildId: process.env.DISCORD_GUILD_ID,
      commandPrefix: process.env.HIBIKI_PREFIX ?? '!',
      /** When set (e.g. to E2E sidecar bot user ID), Hibiki will process prefix commands from this bot for testing. */
      e2eAllowBotId: process.env.HIBIKI_E2E_ALLOW_BOT_ID ?? undefined,
    },
    audio: {
      storageRoot: process.env.HIBIKI_STORAGE_PATH ?? 'storage',
      musicDir: process.env.HIBIKI_MUSIC_DIR ?? 'storage/music',
      effectsDir: process.env.HIBIKI_EFFECTS_DIR ?? 'storage/effects',
      webDistDir: process.env.HIBIKI_WEB_DIST ?? 'web-dist',
    },
    database: {
      path: process.env.HIBIKI_DB_PATH ?? 'storage/data/hibiki.sqlite',
    },
  }
}
