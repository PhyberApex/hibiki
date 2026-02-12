export const configuration = () => ({
  discord: {
    token: process.env.DISCORD_TOKEN ?? '',
    clientId: process.env.DISCORD_CLIENT_ID ?? '',
    defaultGuildId: process.env.DISCORD_GUILD_ID,
    commandPrefix: process.env.HIBIKI_PREFIX ?? '!',
  },
  audio: {
    storageRoot: process.env.HIBIKI_STORAGE_PATH ?? 'storage',
    musicDir: process.env.HIBIKI_MUSIC_DIR ?? 'storage/music',
    effectsDir: process.env.HIBIKI_EFFECTS_DIR ?? 'storage/effects',
    webDistDir: process.env.HIBIKI_WEB_DIST ?? 'apps/bot/web-dist',
  },
});
