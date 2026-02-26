import { configuration } from './configuration'

describe('configuration', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns defaults when env is empty', () => {
    delete process.env.DISCORD_TOKEN
    delete process.env.HIBIKI_USER_DATA
    delete process.env.HIBIKI_STORAGE_PATH
    delete process.env.HIBIKI_MUSIC_DIR
    delete process.env.HIBIKI_EFFECTS_DIR
    delete process.env.HIBIKI_AMBIENCE_DIR
    delete process.env.HIBIKI_WEB_DIST
    delete process.env.HIBIKI_DATA_PATH

    const config = configuration()

    expect(config.discord).toEqual({
      token: '',
    })
    expect(config.audio).toEqual({
      storageRoot: 'storage',
      musicDir: 'storage/music',
      effectsDir: 'storage/effects',
      ambienceDir: 'storage/ambience',
      webDistDir: 'web-dist',
    })
    expect(config.database).toEqual({
      path: 'storage/data/hibiki.json',
    })
  })

  it('returns env values when set', () => {
    delete process.env.HIBIKI_USER_DATA
    process.env.DISCORD_TOKEN = 'token-123'
    process.env.HIBIKI_STORAGE_PATH = '/data/storage'
    process.env.HIBIKI_WEB_DIST = 'dist-web'
    process.env.HIBIKI_DATA_PATH = '/data/app.json'

    const config = configuration()

    expect(config.discord).toEqual({
      token: 'token-123',
    })
    expect(config.audio).toEqual({
      storageRoot: '/data/storage',
      musicDir: '/data/storage/music',
      effectsDir: '/data/storage/effects',
      ambienceDir: '/data/storage/ambience',
      webDistDir: 'dist-web',
    })
    expect(config.database).toEqual({
      path: '/data/app.json',
    })
  })

  it('uses HIBIKI_USER_DATA as base for paths when set', () => {
    process.env.HIBIKI_USER_DATA = '/app/user-data'
    delete process.env.HIBIKI_STORAGE_PATH
    delete process.env.HIBIKI_DATA_PATH

    const config = configuration()

    expect(config.audio.storageRoot).toBe('/app/user-data/storage')
    expect(config.audio.musicDir).toBe('/app/user-data/storage/music')
    expect(config.audio.effectsDir).toBe('/app/user-data/storage/effects')
    expect(config.audio.ambienceDir).toBe('/app/user-data/storage/ambience')
    expect(config.database.path).toBe('/app/user-data/data/hibiki.json')
  })

  it('prefers HIBIKI_STORAGE_PATH over HIBIKI_USER_DATA for audio dirs', () => {
    process.env.HIBIKI_USER_DATA = '/app/user-data'
    process.env.HIBIKI_STORAGE_PATH = '/custom/storage'
    delete process.env.HIBIKI_DATA_PATH

    const config = configuration()

    expect(config.audio.storageRoot).toBe('/custom/storage')
    expect(config.audio.musicDir).toBe('/custom/storage/music')
    expect(config.audio.effectsDir).toBe('/custom/storage/effects')
    expect(config.audio.ambienceDir).toBe('/custom/storage/ambience')
    expect(config.database.path).toBe('/app/user-data/data/hibiki.json')
  })
})
