import type { EmbeddedApi } from './bootstrap-embedded'
import type { createDiscordClient } from './discord/discord-client'
import type { createPlayer } from './player/player'
import { mkdir } from 'node:fs/promises'
import { registerApiHandler } from '../electron/ipc-streams'
import { createShutdownHandler, getEmbeddedApp } from './bootstrap-embedded'
import { getConfig } from './config'
import { createDiscordTokenSettings } from './config/discord-token-settings'
import { createHotkeySettings } from './config/hotkey-settings'
import { createLocalOutputDeviceSettings } from './config/local-output-device-settings'
import { createOutputTargetSettings } from './config/output-target-settings'
import { createDiscordClient as createDiscordClientImpl } from './discord/discord-client'
import { getStorageWarnings } from './json-file'
import { createAppConfig } from './persistence'
import { LOCAL_TARGET_ID } from './player/output-target'
import { createPlayer as createPlayerImpl } from './player/player'
import { exportScene } from './scenes/scene-export'
import { importScene } from './scenes/scene-import'
import { createSceneRegistry, REGISTRY_INDEX_URL } from './scenes/scene-registry'
import { createSceneStore } from './scenes/scene-store'
import { createSoundLibrary } from './sound/sound-library'
import { createUpdateCheck } from './updates/update-check'
import { createUsageStats } from './usage-stats/usage-stats'
import { createVisionSettings } from './vision/vision-settings'
import { createVisionService } from './vision/vision.service'

// getEmbeddedApp wires real services together; every one of them is replaced
// here so these tests exercise only the EmbeddedApi glue: argument guards,
// normalisation and the routing of each call to the right service.
jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(),
}))
jest.mock('@discordjs/voice', () => ({
  generateDependencyReport: jest.fn(() => 'report'),
}))
jest.mock('@snazzah/davey', () => ({}))
jest.mock('./config', () => ({
  getConfig: jest.fn(),
}))
jest.mock('./config/discord-token-settings', () => ({
  createDiscordTokenSettings: jest.fn(),
  isDiscordTokenConfigured: jest.fn(() => false),
}))
jest.mock('./config/hotkey-settings', () => ({
  createHotkeySettings: jest.fn(),
}))
jest.mock('./config/local-output-device-settings', () => ({
  createLocalOutputDeviceSettings: jest.fn(),
}))
jest.mock('./config/output-target-settings', () => ({
  createOutputTargetSettings: jest.fn(),
}))
jest.mock('./config/usage-stats-settings', () => ({
  createUsageStatsSettings: jest.fn(() => ({})),
}))
jest.mock('./discord/discord-client', () => ({
  createDiscordClient: jest.fn(),
}))
jest.mock('./json-file', () => ({
  getStorageWarnings: jest.fn(),
}))
jest.mock('./persistence', () => ({
  createAppConfig: jest.fn(),
}))
jest.mock('./player/player', () => ({
  createPlayer: jest.fn(),
}))
jest.mock('./scenes/scene-export', () => ({
  exportScene: jest.fn(),
}))
jest.mock('./scenes/scene-import', () => ({
  importScene: jest.fn(),
}))
jest.mock('./scenes/scene-registry', () => ({
  ...jest.requireActual('./scenes/scene-registry'),
  createSceneRegistry: jest.fn(),
}))
jest.mock('./scenes/scene-store', () => ({
  createSceneStore: jest.fn(),
}))
jest.mock('./sound/sound-library', () => ({
  createSoundLibrary: jest.fn(),
}))
jest.mock('./updates/update-check', () => ({
  createUpdateCheck: jest.fn(),
}))
jest.mock('./usage-stats/usage-stats', () => ({
  buildUserAgent: jest.fn(() => 'ua'),
  createUmamiSender: jest.fn(() => ({})),
  createUsageStats: jest.fn(),
  resolveUsageStatsHost: jest.fn((host?: string) => host ?? 'https://stats.example'),
  USAGE_STATS_HOST: 'https://stats.example',
  USAGE_STATS_WEBSITE_ID: 'site',
}))
jest.mock('./vision/vision-settings', () => ({
  createVisionSettings: jest.fn(),
}))
jest.mock('./vision/vision.service', () => ({
  createVisionService: jest.fn(),
}))

const spies = {
  debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
  info: jest.spyOn(console, 'info').mockImplementation(() => {}),
  warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
  error: jest.spyOn(console, 'error').mockImplementation(() => {}),
}

type FakePlayer = Pick<ReturnType<typeof createPlayer>, 'destroyAll'>
type FakeDiscord = Pick<ReturnType<typeof createDiscordClient>, 'destroy'>

function createFakePlayer(destroyAll: jest.Mock = jest.fn().mockResolvedValue(undefined)): FakePlayer {
  return { destroyAll }
}

function createFakeDiscord(destroy: jest.Mock = jest.fn().mockResolvedValue(undefined)): FakeDiscord {
  return { destroy }
}

describe('createShutdownHandler', () => {
  // Per-guild error isolation during teardown (one manager's destroy()
  // throwing must not stop the rest) is `destroyAll`'s own contract — see
  // player.spec.ts's "destroyAll" tests. This only needs to check the
  // orchestration this handler adds on top: ordering and idempotency.
  it('destroys every guild manager before destroying the Discord client', async () => {
    const callOrder: string[] = []
    const player = createFakePlayer(jest.fn().mockImplementation(async () => {
      callOrder.push('player.destroyAll')
    }))
    const discord = createFakeDiscord(jest.fn().mockImplementation(async () => {
      callOrder.push('discord.destroy')
    }))

    await createShutdownHandler(player, discord)()

    expect(callOrder).toEqual(['player.destroyAll', 'discord.destroy'])
  })

  it('runs teardown exactly once and resolves every caller when called twice or concurrently', async () => {
    const player = createFakePlayer()
    const discord = createFakeDiscord()
    const close = createShutdownHandler(player, discord)

    const [first, second] = await Promise.all([
      close(),
      close(),
    ])
    await close()

    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    expect(player.destroyAll).toHaveBeenCalledTimes(1)
    expect(discord.destroy).toHaveBeenCalledTimes(1)
  })
})

const config = {
  database: { path: '/data/db/scenes.json' },
  audio: {
    storageRoot: '/data',
    musicDir: '/data/music',
    effectsDir: '/data/effects',
    ambienceDir: '/data/ambience',
  },
  discord: { token: undefined },
}

function voiceChannel(id: string) {
  return {
    id,
    isVoiceBased: () => true,
  }
}

function fakeServices() {
  const store = new Map<string, string>()
  const guild = {
    channels: {
      cache: new Map<string, unknown>([
        [
          'voice-1',
          voiceChannel('voice-1'),
        ],
        [
          'text-1',
          {
            id: 'text-1',
            isVoiceBased: () => false,
          },
        ],
      ]),
    },
  }
  return {
    appConfig: {
      secretsEncrypted: true,
      get: jest.fn(async (key: string) => store.get(key)),
      set: jest.fn(async (key: string, value: string) => {
        store.set(key, value)
      }),
    },
    discord: {
      getClient: () => ({
        guilds: {
          cache: new Map([
            ['guild-1', guild],
          ]),
        },
      }),
      getBotStatus: jest.fn(() => ({ ready: true })),
      listGuildDirectory: jest.fn(() => []),
      login: jest.fn().mockResolvedValue(undefined),
      reconnect: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn().mockResolvedValue(undefined),
    },
    player: {
      getState: jest.fn(() => ({ guilds: [] })),
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      startStream: jest.fn(),
      startEffectStream: jest.fn(),
      setEffectStreamVolume: jest.fn(),
      stopStream: jest.fn(),
      reportLocalSinkHealth: jest.fn(),
      playMusic: jest.fn().mockResolvedValue(undefined),
      stopMusic: jest.fn(),
      setMusicVolume: jest.fn(),
      playAmbience: jest.fn().mockResolvedValue(undefined),
      stopAmbience: jest.fn(),
      setAmbienceVolume: jest.fn(),
      playEffect: jest.fn().mockResolvedValue(undefined),
      stopEffects: jest.fn(),
      stopEffect: jest.fn(),
      destroyAll: jest.fn().mockResolvedValue(undefined),
      onStateChanged: jest.fn(),
    },
    sounds: {
      list: jest.fn(async (category: string) => [
        {
          id: `${category}-1`,
          name: `${category} one`,
          tags: ['forest'],
        },
      ]),
      save: jest.fn(async () => ({ id: 'new' })),
      remove: jest.fn().mockResolvedValue(undefined),
      getFilePath: jest.fn(async () => '/data/music/m.mp3'),
      setTags: jest.fn(async (_c: string, _id: string, tags: string[]) => tags),
      canDecode: jest.fn(async () => true),
    },
    scenes: {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue({ id: 's1' }),
      remove: jest.fn().mockResolvedValue(undefined),
      move: jest.fn().mockResolvedValue(undefined),
      removeSoundFromAll: jest.fn().mockResolvedValue(undefined),
    },
    registry: {
      fetchIndex: jest.fn().mockResolvedValue({ scenes: [] }),
      installFromRegistry: jest.fn().mockResolvedValue({ id: 'installed' }),
    },
    hotkeySettings: {
      get: jest.fn().mockResolvedValue({ enabled: true }),
      set: jest.fn().mockResolvedValue(undefined),
    },
    outputTargets: {
      getActive: jest.fn().mockResolvedValue('local'),
      setActive: jest.fn().mockResolvedValue(undefined),
      getMasterVolume: jest.fn().mockResolvedValue(70),
      setMasterVolume: jest.fn().mockResolvedValue(undefined),
    },
    localOutputDevice: {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
    },
    discordToken: {
      getStatus: jest.fn().mockResolvedValue({ configured: false }),
      setToken: jest.fn().mockResolvedValue({ configured: true }),
      clearToken: jest.fn().mockResolvedValue({ configured: false }),
    },
    visionSettings: {
      get: jest.fn().mockResolvedValue({ enabled: true, configured: true }),
      getProviderConfig: jest.fn(),
      setProvider: jest.fn().mockResolvedValue({}),
      setApiKey: jest.fn().mockResolvedValue({}),
      setOpenAiBaseUrl: jest.fn().mockResolvedValue({}),
      setOpenAiModel: jest.fn().mockResolvedValue({}),
      setEnabled: jest.fn().mockResolvedValue({}),
    },
    vision: {
      analyzeImageVibe: jest.fn().mockResolvedValue({
        vibeTags: ['forest'],
      }),
    },
    updateCheck: {
      getSettings: jest.fn().mockResolvedValue({ enabled: true }),
      setEnabled: jest.fn().mockResolvedValue(undefined),
      check: jest.fn().mockResolvedValue(null),
      dismiss: jest.fn().mockResolvedValue(undefined),
    },
    usageStats: {
      track: jest.fn().mockResolvedValue(undefined),
      getSettings: jest.fn().mockResolvedValue({ enabled: false, prompted: false }),
      setEnabled: jest.fn().mockResolvedValue({ enabled: true, prompted: true }),
      markPrompted: jest.fn().mockResolvedValue({ enabled: false, prompted: true }),
    },
  }
}

type Services = ReturnType<typeof fakeServices>

function stubServiceFactories(services: Services): void {
  jest.mocked(getConfig).mockReturnValue(config as any)
  jest.mocked(createAppConfig).mockReturnValue(services.appConfig as any)
  jest.mocked(createDiscordClientImpl).mockReturnValue(services.discord as any)
  jest.mocked(createPlayerImpl).mockReturnValue(services.player as any)
  jest.mocked(createSoundLibrary).mockReturnValue(services.sounds as any)
  jest.mocked(createSceneStore).mockReturnValue(services.scenes as any)
  jest.mocked(createSceneRegistry).mockReturnValue(services.registry as any)
  jest.mocked(createHotkeySettings).mockReturnValue(services.hotkeySettings as any)
  jest.mocked(createOutputTargetSettings).mockReturnValue(services.outputTargets as any)
  jest.mocked(createLocalOutputDeviceSettings).mockReturnValue(services.localOutputDevice as any)
  jest.mocked(createDiscordTokenSettings).mockReturnValue(services.discordToken as any)
  jest.mocked(createVisionSettings).mockReturnValue(services.visionSettings as any)
  jest.mocked(createVisionService).mockReturnValue(services.vision as any)
  jest.mocked(createUpdateCheck).mockReturnValue(services.updateCheck as any)
  jest.mocked(createUsageStats).mockReturnValue(services.usageStats as any)
}

function fakeIpcMain() {
  const handlers = new Map<string, (event: unknown, payload: any) => unknown>()
  return {
    handle: (channel: string, fn: (event: unknown, payload: any) => unknown) => handlers.set(channel, fn),
    invoke: (channel: string, payload: unknown) => handlers.get(channel)!({}, payload),
  }
}

describe('getEmbeddedApp', () => {
  let services: Services
  let api: EmbeddedApi
  beforeEach(async () => {
    jest.clearAllMocks()
    services = fakeServices()
    stubServiceFactories(services)
    api = (await getEmbeddedApp()).api
    // The storage warm-up lists music; start each test from a clean slate.
    services.sounds.list.mockClear()
  })

  describe('startup', () => {
    it('creates the storage directories and sends app-start once', async () => {
      expect(mkdir).toHaveBeenCalledWith('/data/db', { recursive: true })
      expect(mkdir).toHaveBeenCalledWith('/data/music', { recursive: true })
      expect(mkdir).toHaveBeenCalledWith('/data/effects', { recursive: true })
      expect(mkdir).toHaveBeenCalledWith('/data/ambience', { recursive: true })
      expect(services.usageStats.track).toHaveBeenCalledWith({ name: 'app-start' })
    })

    it('defers the Discord login and logs a failure instead of throwing', async () => {
      const err = new Error('bad token')
      services.discord.login.mockRejectedValueOnce(err)
      expect(services.discord.login).not.toHaveBeenCalled()

      await new Promise(resolve => setImmediate(resolve))
      await Promise.resolve()

      expect(services.discord.login).toHaveBeenCalledTimes(1)
      expect(spies.error).toHaveBeenCalledWith('[hibiki]', 'Discord login failed:', err)
    })

    it('logs a failing storage warm-up and still boots', async () => {
      const err = new Error('corrupt scenes.json')
      services = fakeServices()
      services.scenes.list.mockRejectedValueOnce(err)
      stubServiceFactories(services)

      await expect(getEmbeddedApp()).resolves.toHaveProperty('api')
      expect(spies.error).toHaveBeenCalledWith('[hibiki]', 'Storage warm-up failed:', err)
    })

    it('fetches the default Scene Registry index and logs it', () => {
      expect(createSceneRegistry).toHaveBeenCalledWith(config, REGISTRY_INDEX_URL)
      expect(spies.info).toHaveBeenCalledWith('[hibiki]', `Scene Registry index: ${REGISTRY_INDEX_URL}`)
    })

    it('fetches the index from HIBIKI_REGISTRY_INDEX_URL when set, and logs the override', async () => {
      process.env.HIBIKI_REGISTRY_INDEX_URL = 'http://127.0.0.1:4000/index.json'
      try {
        await getEmbeddedApp()
      }
      finally {
        delete process.env.HIBIKI_REGISTRY_INDEX_URL
      }
      expect(createSceneRegistry).toHaveBeenLastCalledWith(config, 'http://127.0.0.1:4000/index.json')
      expect(spies.info).toHaveBeenCalledWith('[hibiki]', 'Scene Registry index overridden by HIBIKI_REGISTRY_INDEX_URL: http://127.0.0.1:4000/index.json')
    })

    it('exposes the shutdown handler and the player state subscription', async () => {
      const app = await getEmbeddedApp()

      await app.close()

      expect(services.player.destroyAll).toHaveBeenCalledTimes(1)
      expect(services.discord.destroy).toHaveBeenCalledTimes(1)
      expect(app.onPlayerStateChanged).toBe(services.player.onStateChanged)
    })
  })

  describe('player', () => {
    it('joins a voice channel of a known guild', async () => {
      await api.player.join({ guildId: 'guild-1', channelId: 'voice-1' })

      expect(services.player.connect).toHaveBeenCalledWith(expect.objectContaining({ id: 'voice-1' }))
    })

    it('rejects an unknown guild', async () => {
      await expect(api.player.join({ guildId: 'ghost', channelId: 'voice-1' })).rejects.toThrow('Guild not available on bot')
      expect(services.player.connect).not.toHaveBeenCalled()
    })

    it('rejects a missing channel id', async () => {
      await expect(api.player.join({ guildId: 'guild-1', channelId: '' })).rejects.toThrow('Channel ID required')
      await expect(api.player.join({ guildId: 'guild-1' } as any)).rejects.toThrow('Channel ID required')
      expect(services.player.connect).not.toHaveBeenCalled()
    })

    it('rejects an unknown or non-voice channel', async () => {
      await expect(api.player.join({ guildId: 'guild-1', channelId: 'text-1' })).rejects.toThrow('Channel not found or not voice-based')
      await expect(api.player.join({ guildId: 'guild-1', channelId: 'nope' })).rejects.toThrow('Channel not found or not voice-based')
      expect(services.player.connect).not.toHaveBeenCalled()
    })

    it('leaves a guild and rejects a missing guild id', async () => {
      await api.player.leave({ guildId: 'guild-1' })
      expect(services.player.disconnect).toHaveBeenCalledWith('guild-1')

      await expect(api.player.leave({ guildId: '' })).rejects.toThrow('guildId is required')
      expect(services.player.disconnect).toHaveBeenCalledTimes(1)
    })

    it('forwards every playback call to the player with its arguments', async () => {
      const stream = {} as NodeJS.ReadableStream
      const metadata = {
        id: 'm',
        name: 'M',
        filename: 'm.m4a',
        category: 'music',
      }

      api.player.getState()
      api.player.getBotStatus()
      api.player.getGuildDirectory()
      await api.player.stop('g')
      api.player.startStream('g', stream, metadata, 's1')
      api.player.startEffectStream('g', stream, 'browser-1', 40)
      api.player.setEffectStreamVolume('g', 'browser-1', 50)
      api.player.stopStream('g', 's1')
      api.player.reportLocalSinkHealth({ type: 'started' } as any)
      await api.player.playMusic('g', 'm1', { volume: 80, loop: true, fadeInMs: 500 })
      api.player.stopMusic('g', { fadeOutMs: 300 })
      api.player.setMusicVolume('g', 60, { rampMs: 100 })
      await api.player.playAmbience('g', 'a1', { volume: 50, repeatMin: 1, repeatMax: 2 })
      api.player.stopAmbience('g', 'a1', { fadeOutMs: 200 })
      api.player.setAmbienceVolume('g', 'a1', 30, { rampMs: 50 })
      await api.player.playEffect('g', 'e1', { volume: 90 })
      api.player.stopEffects('g')
      api.player.stopEffect('g', 'i1')
      await api.player.reconnect()

      const p = services.player
      expect(p.getState).toHaveBeenCalled()
      expect(services.discord.getBotStatus).toHaveBeenCalled()
      expect(services.discord.listGuildDirectory).toHaveBeenCalled()
      expect(p.stop).toHaveBeenCalledWith('g')
      expect(p.startStream).toHaveBeenCalledWith('g', stream, metadata, 's1')
      expect(p.startEffectStream).toHaveBeenCalledWith('g', stream, 'browser-1', 40)
      expect(p.setEffectStreamVolume).toHaveBeenCalledWith('g', 'browser-1', 50)
      expect(p.stopStream).toHaveBeenCalledWith('g', 's1')
      expect(p.reportLocalSinkHealth).toHaveBeenCalledWith({ type: 'started' })
      expect(p.playMusic).toHaveBeenCalledWith('g', 'm1', { volume: 80, loop: true, fadeInMs: 500 })
      expect(p.stopMusic).toHaveBeenCalledWith('g', { fadeOutMs: 300 })
      expect(p.setMusicVolume).toHaveBeenCalledWith('g', 60, { rampMs: 100 })
      expect(p.playAmbience).toHaveBeenCalledWith('g', 'a1', { volume: 50, repeatMin: 1, repeatMax: 2 })
      expect(p.stopAmbience).toHaveBeenCalledWith('g', 'a1', { fadeOutMs: 200 })
      expect(p.setAmbienceVolume).toHaveBeenCalledWith('g', 'a1', 30, { rampMs: 50 })
      expect(p.playEffect).toHaveBeenCalledWith('g', 'e1', { volume: 90 })
      expect(p.stopEffects).toHaveBeenCalledWith('g')
      expect(p.stopEffect).toHaveBeenCalledWith('g', 'i1')
      expect(services.discord.reconnect).toHaveBeenCalled()
    })
  })

  describe('config', () => {
    it('trims the storage path and reports an empty one as unset', async () => {
      await expect(api.config.getStoragePath()).resolves.toEqual({ path: null })

      await api.config.setStoragePath('  /mnt/sounds  ')
      await expect(api.config.getStoragePath()).resolves.toEqual({ path: '/mnt/sounds' })

      await api.config.setStoragePath('   ')
      await expect(api.config.getStoragePath()).resolves.toEqual({ path: null })
    })

    it('round-trips bookmarks and treats missing or corrupt ones as none', async () => {
      await expect(api.config.getBookmarks()).resolves.toEqual([])

      const bookmarks = [
        { name: 'Tabletop Audio', url: 'https://tabletopaudio.com' },
      ]
      await api.config.setBookmarks(bookmarks)
      await expect(api.config.getBookmarks()).resolves.toEqual(bookmarks)

      await services.appConfig.set('bookmarks', '{not json')
      await expect(api.config.getBookmarks()).resolves.toEqual([])
    })

    it('stores accessibility settings and the scene fade length normalised', async () => {
      await expect(api.config.getAccessibility()).resolves.toEqual({ luminancePulses: true, reduceMotion: null })
      await api.config.setAccessibility({ luminancePulses: false, reduceMotion: 'yes' } as any)
      await expect(api.config.getAccessibility()).resolves.toEqual({ luminancePulses: false, reduceMotion: null })

      await api.config.setSceneFadeLength(2)
      expect(services.appConfig.set).toHaveBeenCalledWith('scene.fadeLength', '2')
      await expect(api.config.getSceneFadeLength()).resolves.toBe(2)
    })

    it('maps a Target id to its kind for the master volume', async () => {
      await api.config.getMasterVolume(LOCAL_TARGET_ID)
      await api.config.setMasterVolume('guild-1', 55)

      expect(services.outputTargets.getMasterVolume).toHaveBeenCalledWith('local')
      expect(services.outputTargets.setMasterVolume).toHaveBeenCalledWith('discord', 55)
    })

    it('forwards the remaining settings to their stores', async () => {
      const device = { deviceId: 'd1', label: 'Headphones' }
      await api.config.getDiscord()
      await api.config.setDiscordToken('t')
      await api.config.clearDiscordToken()
      await api.config.getActiveOutputTarget()
      await api.config.setActiveOutputTarget('discord')
      await api.config.getLocalOutputDevice()
      await api.config.setLocalOutputDevice(device as any)
      await api.config.getHotkeySettings()
      await api.config.setHotkeySettings({ enabled: false } as any)
      await api.config.getVision()
      await api.config.setVisionProvider('openai-compatible')
      await api.config.setVisionApiKey('claude', 'k')
      await api.config.setVisionOpenAiBaseUrl('http://localhost:11434/v1')
      await api.config.setVisionOpenAiModel('llava')
      await api.config.setVisionEnabled(true)
      await api.config.getUsageStats()
      await api.config.setUsageStatsEnabled(true)
      await api.config.markUsageStatsPrompted()
      jest.mocked(getStorageWarnings).mockReturnValue([
        { file: 'scenes.json' },
      ] as any)
      await expect(api.config.getStorageWarnings()).resolves.toEqual([
        { file: 'scenes.json' },
      ])

      expect(services.discordToken.getStatus).toHaveBeenCalled()
      expect(services.discordToken.setToken).toHaveBeenCalledWith('t')
      expect(services.discordToken.clearToken).toHaveBeenCalled()
      expect(services.outputTargets.getActive).toHaveBeenCalled()
      expect(services.outputTargets.setActive).toHaveBeenCalledWith('discord')
      expect(services.localOutputDevice.get).toHaveBeenCalled()
      expect(services.localOutputDevice.set).toHaveBeenCalledWith(device)
      expect(services.hotkeySettings.get).toHaveBeenCalled()
      expect(services.hotkeySettings.set).toHaveBeenCalledWith({ enabled: false })
      expect(services.visionSettings.setProvider).toHaveBeenCalledWith('openai-compatible')
      expect(services.visionSettings.setApiKey).toHaveBeenCalledWith('claude', 'k')
      expect(services.visionSettings.setOpenAiBaseUrl).toHaveBeenCalledWith('http://localhost:11434/v1')
      expect(services.visionSettings.setOpenAiModel).toHaveBeenCalledWith('llava')
      expect(services.visionSettings.setEnabled).toHaveBeenCalledWith(true)
      expect(services.usageStats.getSettings).toHaveBeenCalled()
      expect(services.usageStats.setEnabled).toHaveBeenCalledWith(true)
      expect(services.usageStats.markPrompted).toHaveBeenCalled()
    })
  })

  describe('sounds', () => {
    it('lists each category', async () => {
      await api.sounds.listMusic()
      await api.sounds.listEffects()
      await api.sounds.listAmbience()

      expect(services.sounds.list.mock.calls).toEqual([
        ['music'],
        ['effects'],
        ['ambience'],
      ])
    })

    it('passes a Buffer through on upload', async () => {
      const buffer = Buffer.from([1, 2, 3])

      await api.sounds.uploadSound('music', buffer, 'tavern.mp3')

      expect(services.sounds.save).toHaveBeenCalledWith('music', { buffer, originalname: 'tavern.mp3' })
    })

    it('turns an ArrayBuffer from IPC into a Buffer on upload', async () => {
      const arrayBuffer = new Uint8Array([4, 5, 6]).buffer

      await api.sounds.uploadSound('effects', arrayBuffer as unknown as Buffer, 'door.wav')

      const [, file] = services.sounds.save.mock.calls[0] as unknown as [string, { buffer: Buffer, originalname: string }]
      expect(Buffer.isBuffer(file.buffer)).toBe(true)
      expect([...file.buffer]).toEqual([4, 5, 6])
      expect(file.originalname).toBe('door.wav')
    })

    it('deletes the file (with its Sound Tags) and removes it from every Scene', async () => {
      await api.sounds.deleteSound('ambience', 'a1')

      // sounds.remove drops the Sound Tag entry itself; see sound-library.spec.ts.
      expect(services.sounds.remove).toHaveBeenCalledWith('ambience', 'a1')
      expect(services.scenes.removeSoundFromAll).toHaveBeenCalledWith('ambience', 'a1')
    })

    it('treats non-array tags as none', async () => {
      await api.sounds.setTags('music', 'm1', ['tavern'])
      await api.sounds.setTags('music', 'm1', 'tavern' as unknown as string[])

      expect(services.sounds.setTags).toHaveBeenNthCalledWith(1, 'music', 'm1', ['tavern'])
      expect(services.sounds.setTags).toHaveBeenNthCalledWith(2, 'music', 'm1', [])
    })

    it('forwards file path and decoder lookups', async () => {
      await api.sounds.getFilePath('music', 'm1')
      await api.sounds.canDecode('music', 'm1')

      expect(services.sounds.getFilePath).toHaveBeenCalledWith('music', 'm1')
      expect(services.sounds.canDecode).toHaveBeenCalledWith('music', 'm1')
    })

    it('rejects an unknown category before touching the library or any Scene', async () => {
      const bogus = 'bogus' as never
      await expect(api.sounds.deleteSound(bogus, 'a1')).rejects.toThrow('Invalid sound category \'bogus\'')
      await expect(api.sounds.getFilePath(bogus, 'a1')).rejects.toThrow('Invalid sound category')
      await expect(api.sounds.canDecode(bogus, 'a1')).rejects.toThrow('Invalid sound category')
      await expect(api.sounds.setTags(bogus, 'a1', [])).rejects.toThrow('Invalid sound category')
      await expect(api.sounds.uploadSound(bogus, Buffer.from([1]), 'x.mp3')).rejects.toThrow('Invalid sound category')

      expect(services.sounds.remove).not.toHaveBeenCalled()
      expect(services.scenes.removeSoundFromAll).not.toHaveBeenCalled()
      expect(services.sounds.getFilePath).not.toHaveBeenCalled()
      expect(services.sounds.canDecode).not.toHaveBeenCalled()
      expect(services.sounds.setTags).not.toHaveBeenCalled()
      expect(services.sounds.save).not.toHaveBeenCalled()
    })
  })

  describe('scenes and registry', () => {
    it('forwards to the scene store, import/export and the registry', async () => {
      const scene = { name: 'Tavern' }
      await api.scenes.list()
      await api.scenes.get('s1')
      await api.scenes.save(scene)
      await api.scenes.remove('s1')
      await api.scenes.move('s1', 2)
      await api.scenes.exportScene('s1', '/tmp/tavern.hibiki.zip')
      await api.scenes.importScene('/tmp/tavern.hibiki.zip')
      await api.registry.getIndex()
      await api.registry.getIndex(true)
      await api.registry.installFromRegistry('tavern')

      expect(services.scenes.get).toHaveBeenCalledWith('s1')
      expect(services.scenes.save).toHaveBeenCalledWith(scene)
      expect(services.scenes.remove).toHaveBeenCalledWith('s1')
      expect(services.scenes.move).toHaveBeenCalledWith('s1', 2)
      expect(exportScene).toHaveBeenCalledWith(config, 's1', '/tmp/tavern.hibiki.zip')
      expect(importScene).toHaveBeenCalledWith(config, '/tmp/tavern.hibiki.zip')
      expect(services.registry.fetchIndex).toHaveBeenNthCalledWith(1, false)
      expect(services.registry.fetchIndex).toHaveBeenNthCalledWith(2, true)
      expect(services.registry.installFromRegistry).toHaveBeenCalledWith('tavern')
    })
  })

  describe('vision', () => {
    it('analyzes an image when Vision to Vibe is on and configured', async () => {
      await expect(api.vision.analyzeImageVibe('/tmp/map.png')).resolves.toEqual({
        vibeTags: ['forest'],
      })
      expect(services.vision.analyzeImageVibe).toHaveBeenCalledWith('/tmp/map.png')
    })

    it('refuses while the toggle is off', async () => {
      services.visionSettings.get.mockResolvedValueOnce({ enabled: false, configured: true })

      await expect(api.vision.analyzeImageVibe('/tmp/map.png')).rejects.toThrow('Vision to Vibe is turned off')
      expect(services.vision.analyzeImageVibe).not.toHaveBeenCalled()
    })

    it('refuses while the selected provider is not configured', async () => {
      services.visionSettings.get.mockResolvedValueOnce({ enabled: true, configured: false })

      await expect(api.vision.analyzeImageVibe('/tmp/map.png')).rejects.toThrow('The selected Vision Provider is not configured')
      expect(services.vision.analyzeImageVibe).not.toHaveBeenCalled()
    })

    it('matches Vibe Tags against the Music and Ambience libraries only', async () => {
      const matches = await api.vision.matchVibe(['forest'])

      expect(services.sounds.list.mock.calls).toEqual([
        ['music'],
        ['ambience'],
      ])
      expect(matches.music.map(m => m.sound.id)).toEqual(['music-1'])
      expect(matches.ambience.map(m => m.sound.id)).toEqual(['ambience-1'])
    })
  })

  describe('updates and usage stats', () => {
    it('forwards the update check calls', async () => {
      await api.updates.getSettings()
      await api.updates.setEnabled(false)
      await api.updates.check()
      await api.updates.dismiss('2.0.0')

      expect(services.updateCheck.getSettings).toHaveBeenCalled()
      expect(services.updateCheck.setEnabled).toHaveBeenCalledWith(false)
      expect(services.updateCheck.check).toHaveBeenCalled()
      expect(services.updateCheck.dismiss).toHaveBeenCalledWith('2.0.0')
    })

    it('tracks renderer events but drops a renderer app-start with a warning', async () => {
      services.usageStats.track.mockClear()

      await api.usageStats.track({ name: 'scene-play' } as any)
      await api.usageStats.track({ name: 'app-start' })

      expect(services.usageStats.track).toHaveBeenCalledTimes(1)
      expect(services.usageStats.track).toHaveBeenCalledWith({ name: 'scene-play' })
      expect(spies.warn).toHaveBeenCalledWith('[hibiki]', expect.stringContaining('app-start is sent by the main process only'))
    })
  })

  // The re-sync and failure logging live in the generic `api` IPC handler;
  // driving the real EmbeddedApi through it pins which of its calls re-sync.
  describe('through the generic api IPC handler', () => {
    const hotkeyMutations: [string, string, unknown[]][] = [
      [
        'scenes',
        'save',
        [
          { name: 'Tavern' },
        ],
      ],
      [
        'scenes',
        'remove',
        ['s1'],
      ],
      [
        'scenes',
        'importScene',
        ['/tmp/tavern.hibiki.zip'],
      ],
      [
        'registry',
        'installFromRegistry',
        ['tavern'],
      ],
      [
        'config',
        'setHotkeySettings',
        [
          { enabled: false },
        ],
      ],
    ]

    function registerThroughIpc() {
      const ipc = fakeIpcMain()
      const hotkeys = {
        sync: jest.fn().mockResolvedValue(undefined),
      }
      registerApiHandler(ipc, api, () => hotkeys)
      return { ipc, hotkeys }
    }

    it.each(hotkeyMutations)('re-syncs hotkeys exactly once after %s.%s', async (domain, method, args) => {
      const { ipc, hotkeys } = registerThroughIpc()

      await ipc.invoke('api', { domain, method, args })

      expect(hotkeys.sync).toHaveBeenCalledTimes(1)
    })

    it('does not re-sync hotkeys after a call outside scenes, registry and the hotkey settings', async () => {
      const { ipc, hotkeys } = registerThroughIpc()

      await ipc.invoke('api', {
        domain: 'player',
        method: 'stop',
        args: ['g'],
      })
      await ipc.invoke('api', {
        domain: 'config',
        method: 'setVisionEnabled',
        args: [true],
      })
      await ipc.invoke('api', {
        domain: 'sounds',
        method: 'deleteSound',
        args: ['music', 'm1'],
      })

      expect(hotkeys.sync).not.toHaveBeenCalled()
    })

    it('logs a failing call with its domain and method', async () => {
      const { ipc } = registerThroughIpc()

      await expect(ipc.invoke('api', {
        domain: 'player',
        method: 'join',
        args: [
          { guildId: 'ghost', channelId: 'voice-1' },
        ],
      }))
        .rejects
        .toThrow('Guild not available on bot')
      expect(spies.error).toHaveBeenCalledWith('[ipc]', 'player.join failed:', expect.objectContaining({ message: 'Guild not available on bot' }))
    })
  })
})
