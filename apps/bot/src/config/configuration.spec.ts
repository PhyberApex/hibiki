import { configuration } from './configuration'

describe('configuration', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  it('returns defaults when env is empty', () => {
    delete process.env.DISCORD_TOKEN
    delete process.env.DISCORD_CLIENT_ID
    delete process.env.DISCORD_GUILD_ID
    delete process.env.HIBIKI_PREFIX
    delete process.env.HIBIKI_E2E_ALLOW_BOT_ID
    delete process.env.HIBIKI_STORAGE_PATH
    delete process.env.HIBIKI_MUSIC_DIR
    delete process.env.HIBIKI_EFFECTS_DIR
    delete process.env.HIBIKI_WEB_DIST
    delete process.env.HIBIKI_DB_PATH

    const config = configuration()

    expect(config.discord).toEqual({
      token: '',
      clientId: '',
      defaultGuildId: undefined,
      commandPrefix: '!',
      e2eAllowBotId: undefined,
    })
    expect(config.audio).toEqual({
      storageRoot: 'storage',
      musicDir: 'storage/music',
      effectsDir: 'storage/effects',
      webDistDir: 'web-dist',
    })
    expect(config.database).toEqual({
      path: 'storage/data/hibiki.sqlite',
    })
  })

  it('returns env values when set', () => {
    process.env.DISCORD_TOKEN = 'token-123'
    process.env.DISCORD_CLIENT_ID = 'client-456'
    process.env.DISCORD_GUILD_ID = 'guild-789'
    process.env.HIBIKI_PREFIX = '?'
    process.env.HIBIKI_E2E_ALLOW_BOT_ID = 'e2e-bot-id'
    process.env.HIBIKI_STORAGE_PATH = '/data/storage'
    process.env.HIBIKI_MUSIC_DIR = '/data/music'
    process.env.HIBIKI_EFFECTS_DIR = '/data/effects'
    process.env.HIBIKI_WEB_DIST = 'dist-web'
    process.env.HIBIKI_DB_PATH = '/data/db.sqlite'

    const config = configuration()

    expect(config.discord).toEqual({
      token: 'token-123',
      clientId: 'client-456',
      defaultGuildId: 'guild-789',
      commandPrefix: '?',
      e2eAllowBotId: 'e2e-bot-id',
    })
    expect(config.audio).toEqual({
      storageRoot: '/data/storage',
      musicDir: '/data/music',
      effectsDir: '/data/effects',
      webDistDir: 'dist-web',
    })
    expect(config.database).toEqual({
      path: '/data/db.sqlite',
    })
  })
})
