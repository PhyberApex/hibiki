import type { VoiceBasedChannel } from 'discord.js'
import type { AccessibilitySettings } from './config/accessibility-settings'
import type { SoundCategory } from './sound/sound.types'
import type { VibeMatches } from './vision/vibe-matching'
import type { VisionSettingsState } from './vision/vision-settings'
import type { VibeAnalysis } from './vision/vision.service'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { generateDependencyReport } from '@discordjs/voice'
import { getConfig } from './config'
import { normalizeAccessibilitySettings, parseAccessibilitySettings } from './config/accessibility-settings'
import { createDiscordClient } from './discord/discord-client'
import { createAppConfig } from './persistence'
import { createPlayer } from './player/player'
import { exportScene } from './scenes/scene-export'
import { importScene } from './scenes/scene-import'
import { createSceneRegistry } from './scenes/scene-registry'
import { createSceneStore } from './scenes/scene-store'
import { createSoundLibrary } from './sound/sound-library'
import { matchVibeLibrary } from './vision/vibe-matching'
import { createVisionSettings } from './vision/vision-settings'
import { createVisionService } from './vision/vision.service'

async function ensureStorageDirs(config: ReturnType<typeof getConfig>): Promise<void> {
  const dbPath = config.database.path
  await Promise.all([
    mkdir(dirname(dbPath), { recursive: true }),
    mkdir(config.audio.musicDir, { recursive: true }),
    mkdir(config.audio.effectsDir, { recursive: true }),
    mkdir(config.audio.ambienceDir, { recursive: true }),
  ])
}

function resolveChannel(
  discord: ReturnType<typeof createDiscordClient>,
  guildId: string,
  channelId?: string,
): VoiceBasedChannel {
  const client = discord.getClient()
  const guild = client.guilds.cache.get(guildId)
  if (!guild)
    throw new Error('Guild not available on bot')
  if (!channelId)
    throw new Error('Channel ID required')
  const channel = guild.channels.cache.get(channelId)
  if (!channel || !channel.isVoiceBased())
    throw new Error('Channel not found or not voice-based')
  return channel as VoiceBasedChannel
}

export interface EmbeddedApi {
  player: {
    getState: () => ReturnType<ReturnType<typeof createPlayer>['getState']>
    getBotStatus: () => ReturnType<ReturnType<typeof createDiscordClient>['getBotStatus']>
    getGuildDirectory: () => ReturnType<ReturnType<typeof createDiscordClient>['listGuildDirectory']>
    getVolume: (guildId: string) => ReturnType<ReturnType<typeof createPlayer>['getVolume']>
    setVolume: (guildId: string, updates: { music?: number, effects?: number }) => ReturnType<ReturnType<typeof createPlayer>['setVolume']>
    join: (body: { guildId: string, channelId: string }) => Promise<void>
    leave: (body: { guildId: string }) => Promise<void>
    stop: (guildId: string) => Promise<void>
    startStream: (guildId: string, stream: NodeJS.ReadableStream, metadata?: { id: string, name: string, filename: string, category: string }) => void
    startEffectStream: (guildId: string, stream: NodeJS.ReadableStream) => void
    stopStream: (guildId: string) => void
    reconnect: () => Promise<void>
  }
  config: {
    getDiscord: () => Promise<{ tokenConfigured: boolean }>
    setDiscordToken: (token: string) => Promise<{ tokenConfigured: boolean }>
    getStoragePath: () => Promise<{ path: string | null }>
    setStoragePath: (path: string) => Promise<void>
    getBookmarks: () => Promise<{ name: string, url: string, favicon?: string }[]>
    setBookmarks: (bookmarks: { name: string, url: string, favicon?: string }[]) => Promise<void>
    getAccessibility: () => Promise<AccessibilitySettings>
    setAccessibility: (settings: AccessibilitySettings) => Promise<void>
    getVision: () => Promise<VisionSettingsState>
    setVisionApiKey: (apiKey: string) => Promise<VisionSettingsState>
    setVisionEnabled: (enabled: boolean) => Promise<VisionSettingsState>
  }
  sounds: {
    listMusic: () => ReturnType<ReturnType<typeof createSoundLibrary>['list']>
    listEffects: () => ReturnType<ReturnType<typeof createSoundLibrary>['list']>
    listAmbience: () => ReturnType<ReturnType<typeof createSoundLibrary>['list']>
    uploadSound: (type: SoundCategory, buffer: Buffer, originalname: string) => ReturnType<ReturnType<typeof createSoundLibrary>['save']>
    deleteSound: (type: SoundCategory, id: string) => ReturnType<ReturnType<typeof createSoundLibrary>['remove']>
    getFilePath: (type: SoundCategory, id: string) => ReturnType<ReturnType<typeof createSoundLibrary>['getFilePath']>
    setTags: (type: SoundCategory, id: string, tags: string[]) => ReturnType<ReturnType<typeof createSoundLibrary>['setTags']>
  }
  scenes: {
    list: () => ReturnType<ReturnType<typeof createSceneStore>['list']>
    get: (id: string) => ReturnType<ReturnType<typeof createSceneStore>['get']>
    save: (scene: { id?: string, name: string, ambience?: { soundId: string, soundName?: string, volume?: number, enabled?: boolean }[], music?: { soundId: string, soundName?: string, volume?: number, loop?: boolean }[], effects?: { soundId: string, soundName?: string }[] }) => ReturnType<ReturnType<typeof createSceneStore>['save']>
    remove: (id: string) => ReturnType<ReturnType<typeof createSceneStore>['remove']>
    exportScene: (id: string, targetPath: string) => Promise<void>
    importScene: (sourcePath: string) => Promise<import('./scenes/scene-store').Scene>
  }
  registry: {
    getIndex: (forceRefresh?: boolean) => Promise<import('./scenes/scene-package.types').RegistryIndex>
    installFromRegistry: (slug: string) => Promise<import('./scenes/scene-store').Scene>
  }
  vision: {
    analyzeImageVibe: (imagePath: string) => Promise<VibeAnalysis>
    matchVibe: (vibeTags: string[]) => Promise<VibeMatches>
  }
}

export interface EmbeddedApp {
  close: () => Promise<void>
  api: EmbeddedApi
}

export async function getEmbeddedApp(): Promise<EmbeddedApp> {
  process.env.HIBIKI_EMBEDDED = '1'
  const report = generateDependencyReport()
  console.warn('[Hibiki] Voice dependency report:\n', report)
  const config = getConfig()
  await ensureStorageDirs(config)
  const appConfig = createAppConfig(config)
  const sounds = createSoundLibrary(config)
  const scenes = createSceneStore(config)
  const registry = createSceneRegistry(config)
  const discord = createDiscordClient(config, appConfig)
  const player = createPlayer(discord)

  const visionSettings = createVisionSettings(config, appConfig)
  const vision = createVisionService({ getApiKey: visionSettings.getApiKey })

  // Defer login to avoid blocking app startup
  // Discord will connect in background after main window shows
  setImmediate(() => {
    discord.login().catch((err) => {
      console.error('Discord login failed:', err)
    })
  })

  const api: EmbeddedApi = {
    player: {
      getState: () => player.getState(),
      getBotStatus: () => discord.getBotStatus(),
      getGuildDirectory: () => discord.listGuildDirectory(),
      getVolume: guildId => player.getVolume(guildId),
      setVolume: (guildId, updates) => player.setVolume(guildId, updates),
      join: async (body) => {
        const channel = resolveChannel(discord, body.guildId, body.channelId)
        await player.connect(channel)
      },
      leave: async (body) => {
        if (!body.guildId)
          throw new Error('guildId is required')
        await player.disconnect(body.guildId)
      },
      stop: guildId => player.stop(guildId),
      startStream: (guildId, stream, metadata) =>
        player.startStream(guildId, stream as import('node:stream').Readable, metadata as import('./player/player').TrackMetadata | undefined),
      startEffectStream: (guildId, stream) =>
        player.startEffectStream(guildId, stream as import('node:stream').Readable),
      stopStream: guildId => player.stopStream(guildId),
      reconnect: () => discord.reconnect(),
    },
    config: {
      getDiscord: async () => {
        const fromEnv = config.discord.token
        if (fromEnv)
          return { tokenConfigured: true }
        const fromDb = await appConfig.get('discord.token')
        return { tokenConfigured: Boolean(fromDb) }
      },
      setDiscordToken: async (token) => {
        if (typeof token === 'string' && token.trim()) {
          await appConfig.set('discord.token', token.trim())
          return { tokenConfigured: true }
        }
        const fromEnv = config.discord.token
        if (fromEnv)
          return { tokenConfigured: true }
        const fromDb = await appConfig.get('discord.token')
        return { tokenConfigured: Boolean(fromDb) }
      },
      getStoragePath: async () => {
        const p = await appConfig.get('storage.path')
        return { path: p && p.trim() ? p.trim() : null }
      },
      setStoragePath: async (path: string) => {
        const value = path.trim() || ''
        await appConfig.set('storage.path', value)
      },
      getBookmarks: async () => {
        const raw = await appConfig.get('bookmarks')
        if (!raw)
          return []
        try {
          return JSON.parse(raw)
        }
        catch {
          return []
        }
      },
      setBookmarks: async (bookmarks: { name: string, url: string, favicon?: string }[]) => {
        await appConfig.set('bookmarks', JSON.stringify(bookmarks))
      },
      getAccessibility: async () => parseAccessibilitySettings(await appConfig.get('accessibility')),
      setAccessibility: async (settings) => {
        await appConfig.set('accessibility', JSON.stringify(normalizeAccessibilitySettings(settings)))
      },
      getVision: () => visionSettings.get(),
      setVisionApiKey: apiKey => visionSettings.setApiKey(apiKey),
      setVisionEnabled: enabled => visionSettings.setEnabled(enabled),
    },
    sounds: {
      listMusic: () => sounds.list('music'),
      listEffects: () => sounds.list('effects'),
      listAmbience: () => sounds.list('ambience'),
      uploadSound: (type, bufferOrArrayBuffer: Buffer | ArrayBuffer, originalname: string) =>
        sounds.save(type, {
          buffer: Buffer.isBuffer(bufferOrArrayBuffer) ? bufferOrArrayBuffer : Buffer.from(bufferOrArrayBuffer),
          originalname,
        }),
      deleteSound: async (type, id) => {
        await sounds.remove(type, id)
        await scenes.removeSoundFromAll(type, id)
      },
      getFilePath: (type, id) => sounds.getFilePath(type, id),
      setTags: (type, id, tags) => sounds.setTags(type, id, Array.isArray(tags) ? tags : []),
    },
    scenes: {
      list: () => scenes.list(),
      get: id => scenes.get(id),
      save: scene => scenes.save(scene),
      remove: id => scenes.remove(id),
      exportScene: (id, targetPath) => exportScene(config, id, targetPath),
      importScene: sourcePath => importScene(config, sourcePath),
    },
    registry: {
      getIndex: forceRefresh => registry.fetchIndex(forceRefresh ?? false),
      installFromRegistry: slug => registry.installFromRegistry(slug),
    },
    vision: {
      analyzeImageVibe: async (imagePath) => {
        const { enabled } = await visionSettings.get()
        if (!enabled)
          throw new Error('Vision to Vibe is turned off. Enable it in Settings first.')
        return vision.analyzeImageVibe(imagePath)
      },
      matchVibe: async (vibeTags) => {
        const [music, ambience] = await Promise.all([sounds.list('music'), sounds.list('ambience')])
        return matchVibeLibrary(vibeTags, { music, ambience })
      },
    },
  }

  return {
    close: () => discord.destroy(),
    api,
  }
}
