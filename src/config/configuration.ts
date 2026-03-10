import { join } from 'node:path'

function getBasePath(): string | null {
  return process.env.HIBIKI_USER_DATA ?? null
}

export function configuration() {
  const base = getBasePath()
  const customStorage = process.env.HIBIKI_STORAGE_PATH
  const storageRoot = customStorage ?? (base ? join(base, 'storage') : 'storage')
  const musicDir = customStorage
    ? join(customStorage, 'music')
    : (base ? join(base, 'storage', 'music') : (process.env.HIBIKI_MUSIC_DIR ?? 'storage/music'))
  const effectsDir = customStorage
    ? join(customStorage, 'effects')
    : (base ? join(base, 'storage', 'effects') : (process.env.HIBIKI_EFFECTS_DIR ?? 'storage/effects'))
  const ambienceDir = customStorage
    ? join(customStorage, 'ambience')
    : (base ? join(base, 'storage', 'ambience') : (process.env.HIBIKI_AMBIENCE_DIR ?? 'storage/ambience'))
  const dbPath = base
    ? join(base, 'data', 'hibiki.json')
    : (process.env.HIBIKI_DATA_PATH ?? 'storage/data/hibiki.json')

  return {
    discord: {
      token: process.env.DISCORD_TOKEN ?? '',
    },
    audio: {
      storageRoot,
      musicDir,
      effectsDir,
      ambienceDir,
      webDistDir: process.env.HIBIKI_WEB_DIST ?? 'web-dist',
    },
    database: {
      path: dbPath,
    },
  }
}
