import type { VoiceBasedChannel } from 'discord.js'
import type { AccessibilitySettings } from './config/accessibility-settings'
import type { HotkeySettings } from './config/hotkey-settings'
import type { LocalOutputDevice } from './config/local-output-device-settings'
import type { StorageWarning } from './json-file'
import type { SecretCodec } from './persistence'
import type { OutputTargetKind } from './player/output-target'
import type { MusicMode } from './scenes/scene-store'
import type { SoundCategory } from './sound/sound.types'
import type { AvailableUpdate, UpdateCheckSettings } from './updates/update-check'
import type { VibeMatches } from './vision/vibe-matching'
import type { VisionSettingsState } from './vision/vision-settings'
import type { VibeAnalysis, VisionProviderId } from './vision/vision.service'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { generateDependencyReport } from '@discordjs/voice'
import { getConfig } from './config'
import { normalizeAccessibilitySettings, parseAccessibilitySettings } from './config/accessibility-settings'
import { createHotkeySettings } from './config/hotkey-settings'
import { createLocalOutputDeviceSettings } from './config/local-output-device-settings'
import { createOutputTargetSettings } from './config/output-target-settings'
import { normalizeSceneFadeLength, parseSceneFadeLength } from './config/scene-fade-settings'
import { createDiscordClient } from './discord/discord-client'
import { getStorageWarnings } from './json-file'
import { createLogger } from './logger'
import { createAppConfig } from './persistence'
import { targetKind } from './player/output-target'
import { createPlayer } from './player/player'
import { exportScene } from './scenes/scene-export'
import { importScene } from './scenes/scene-import'
import { createSceneRegistry } from './scenes/scene-registry'
import { createSceneStore } from './scenes/scene-store'
import { createSoundLibrary } from './sound/sound-library'
import { createUpdateCheck } from './updates/update-check'
import { getVersion } from './version'
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
    join: (body: { guildId: string, channelId: string }) => Promise<void>
    leave: (body: { guildId: string }) => Promise<void>
    stop: (guildId: string) => Promise<void>
    startStream: (guildId: string, stream: NodeJS.ReadableStream, metadata?: { id: string, name: string, filename: string, category: string }, streamId?: string) => void
    startEffectStream: (guildId: string, stream: NodeJS.ReadableStream, streamId?: string, volume?: number) => void
    setEffectStreamVolume: (guildId: string, streamId: string, volume: number) => void
    stopStream: (guildId: string, streamId?: string) => void
    reportLocalSinkHealth: (event: import('./player/player').LocalSinkHealth) => void
    playMusic: (guildId: string, soundId: string, options: { volume: number, loop?: boolean, fadeInMs?: number }) => Promise<void>
    stopMusic: (guildId: string, options?: { fadeOutMs?: number }) => void
    setMusicVolume: (guildId: string, volume: number, options?: { rampMs?: number }) => void
    playAmbience: (guildId: string, soundId: string, options: { volume: number, repeatMin: number, repeatMax: number, fadeInMs?: number }) => Promise<void>
    stopAmbience: (guildId: string, soundId: string, options?: { fadeOutMs?: number }) => void
    setAmbienceVolume: (guildId: string, soundId: string, volume: number, options?: { rampMs?: number }) => void
    playEffect: (guildId: string, soundId: string, options: { volume: number }) => Promise<{ instanceId: string, soundId: string, startedAt: string, durationMs: number } | undefined>
    stopEffects: (guildId: string) => void
    stopEffect: (guildId: string, instanceId: string) => void
    reconnect: () => Promise<void>
  }
  config: {
    getDiscord: () => Promise<{ tokenConfigured: boolean, encrypted: boolean }>
    setDiscordToken: (token: string) => Promise<{ tokenConfigured: boolean, encrypted: boolean }>
    getStoragePath: () => Promise<{ path: string | null }>
    setStoragePath: (path: string) => Promise<void>
    getBookmarks: () => Promise<{ name: string, url: string, favicon?: string }[]>
    setBookmarks: (bookmarks: { name: string, url: string, favicon?: string }[]) => Promise<void>
    getAccessibility: () => Promise<AccessibilitySettings>
    setAccessibility: (settings: AccessibilitySettings) => Promise<void>
    getSceneFadeLength: () => Promise<number>
    setSceneFadeLength: (seconds: number) => Promise<void>
    getActiveOutputTarget: () => Promise<OutputTargetKind>
    setActiveOutputTarget: (kind: OutputTargetKind) => Promise<void>
    getLocalOutputDevice: () => Promise<LocalOutputDevice | null>
    setLocalOutputDevice: (device: LocalOutputDevice | null) => Promise<void>
    getMasterVolume: (targetId: string) => Promise<number>
    setMasterVolume: (targetId: string, volume: number) => Promise<void>
    getHotkeySettings: () => Promise<HotkeySettings>
    setHotkeySettings: (settings: HotkeySettings) => Promise<void>
    getVision: () => Promise<VisionSettingsState>
    setVisionProvider: (provider: VisionProviderId) => Promise<VisionSettingsState>
    setVisionApiKey: (provider: VisionProviderId, apiKey: string) => Promise<VisionSettingsState>
    setVisionOpenAiBaseUrl: (baseUrl: string) => Promise<VisionSettingsState>
    setVisionOpenAiModel: (model: string) => Promise<VisionSettingsState>
    setVisionEnabled: (enabled: boolean) => Promise<VisionSettingsState>
    getStorageWarnings: () => Promise<StorageWarning[]>
  }
  sounds: {
    listMusic: () => ReturnType<ReturnType<typeof createSoundLibrary>['list']>
    listEffects: () => ReturnType<ReturnType<typeof createSoundLibrary>['list']>
    listAmbience: () => ReturnType<ReturnType<typeof createSoundLibrary>['list']>
    uploadSound: (type: SoundCategory, buffer: Buffer, originalname: string) => ReturnType<ReturnType<typeof createSoundLibrary>['save']>
    deleteSound: (type: SoundCategory, id: string) => ReturnType<ReturnType<typeof createSoundLibrary>['remove']>
    getFilePath: (type: SoundCategory, id: string) => ReturnType<ReturnType<typeof createSoundLibrary>['getFilePath']>
    setTags: (type: SoundCategory, id: string, tags: string[]) => ReturnType<ReturnType<typeof createSoundLibrary>['setTags']>
    canDecode: (type: SoundCategory, id: string) => ReturnType<ReturnType<typeof createSoundLibrary>['canDecode']>
  }
  scenes: {
    list: () => ReturnType<ReturnType<typeof createSceneStore>['list']>
    get: (id: string) => ReturnType<ReturnType<typeof createSceneStore>['get']>
    save: (scene: { id?: string, name: string, ambience?: { soundId: string, soundName?: string, volume?: number, enabled?: boolean }[], music?: { soundId: string, soundName?: string, volume?: number, loop?: boolean }[], effects?: { soundId: string, soundName?: string, hotkey?: string }[], musicMode?: MusicMode, hotkey?: string }) => ReturnType<ReturnType<typeof createSceneStore>['save']>
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
  updates: {
    getSettings: () => Promise<UpdateCheckSettings>
    setEnabled: (enabled: boolean) => Promise<void>
    check: () => Promise<AvailableUpdate | null>
    dismiss: (version: string) => Promise<void>
  }
}

export interface EmbeddedApp {
  close: () => Promise<void>
  api: EmbeddedApi
  /**
   * Subscribes to backend-initiated player state changes (e.g. an
   * auto-torn-down voice connection) so the main process can push them to
   * the renderer. Returns an unsubscribe function.
   */
  onPlayerStateChanged: (listener: () => void) => () => void
}

/**
 * Builds the backend's `close()` entry point — guild audio teardown before
 * the Discord client is destroyed (see issue #456). Shared across repeated/
 * concurrent calls (both Electron quit handlers can fire `close()`) so
 * teardown runs exactly once and every caller awaits the same settle,
 * rather than racing two independent teardowns. A throwing `destroyAll()`
 * would already be isolated per-guild internally; this only needs to chain
 * it ahead of destroying the Discord client.
 */
const log = createLogger('hibiki')

/**
 * `@snazzah/davey` (Discord's end-to-end voice encryption) silently falls
 * back from its native binary to a WASM build when the native one fails to
 * load; the dependency report only prints the package version, so this is
 * the only place that says which one is actually running.
 */
function describeDaveBackend(): string {
  try {
    // eslint-disable-next-line ts/no-require-imports -- probing what the voice library itself loads
    require('@snazzah/davey')
  }
  catch (err) {
    return `failed to load: ${err instanceof Error ? err.message : String(err)}`
  }
  const loaded = Object.keys(require.cache).filter(file => /[\\/]@snazzah[\\/]davey/.test(file))
  const native = loaded.find(file => file.endsWith('.node'))
  if (native)
    return `native (${native})`
  const wasm = loaded.find(file => /wasi|wasm/.test(file))
  if (wasm)
    return `WASM fallback (${wasm}); the native binary did not load`
  return `unknown (${loaded.length} module(s) loaded)`
}

export function createShutdownHandler(
  player: Pick<ReturnType<typeof createPlayer>, 'destroyAll'>,
  discord: Pick<ReturnType<typeof createDiscordClient>, 'destroy'>,
): () => Promise<void> {
  let closePromise: Promise<void> | undefined
  return function close(): Promise<void> {
    if (!closePromise) {
      closePromise = (async () => {
        log.info('Shutting down: tearing down voice and Discord client')
        await player.destroyAll()
        await discord.destroy()
        log.info('Shutdown complete')
      })()
    }
    return closePromise
  }
}

export interface EmbeddedAppOptions {
  /** Delivers the Local Target's mix to the renderer (the main process owns the window); see ADR-0004. */
  localSink?: import('./audio/local-sink-pump').LocalSink
  /** The running app's version (`app.getVersion()`), which the update check compares against. */
  appVersion?: string
}

export async function getEmbeddedApp(codec?: SecretCodec, options: EmbeddedAppOptions = {}): Promise<EmbeddedApp> {
  process.env.HIBIKI_EMBEDDED = '1'
  const report = generateDependencyReport()
  log.info('Voice dependency report:\n', report)
  log.info(`DAVE library backend: ${describeDaveBackend()}`)
  const config = getConfig()
  await ensureStorageDirs(config)
  log.info(`Storage root ${config.audio.storageRoot}: music ${config.audio.musicDir}, effects ${config.audio.effectsDir}, ambience ${config.audio.ambienceDir}, data ${config.database.path}`)
  const appConfig = createAppConfig(config, codec)
  log.info(`Secrets at rest are ${appConfig.secretsEncrypted ? 'encrypted' : 'NOT encrypted (no OS keychain backend available)'}`)

  async function getDiscordStatus(): Promise<{ tokenConfigured: boolean, encrypted: boolean }> {
    const tokenConfigured = Boolean(config.discord.token) || Boolean(await appConfig.get('discord.token'))
    return { tokenConfigured, encrypted: appConfig.secretsEncrypted }
  }

  const localOutputDevice = createLocalOutputDeviceSettings(appConfig)
  const outputTargets = createOutputTargetSettings(appConfig, async () => (await getDiscordStatus()).tokenConfigured)

  const sounds = createSoundLibrary(config)
  const hotkeySettings = createHotkeySettings(appConfig, () => createSceneStore(config).list())
  const scenes = createSceneStore(config, { getActionHotkeys: hotkeySettings.getActionHotkeys })
  const registry = createSceneRegistry(config)
  const discord = createDiscordClient(config, appConfig)
  const player = createPlayer(discord, sounds, { localSink: options.localSink })

  const visionSettings = createVisionSettings(config, appConfig)
  const updateCheck = createUpdateCheck({ store: appConfig, currentVersion: options.appVersion ?? getVersion(), fetch })
  const vision = createVisionService({ getProviderConfig: visionSettings.getProviderConfig })

  // Read scenes.json, app-config.json, and (via sounds.list, which reads the
  // sound-tags store) sound-tags.json up front, so a corrupt file is detected
  // and its storage warning recorded before the frontend asks for warnings on launch.
  // This also migrates any legacy plaintext secret (discord.token, vision.apiKey)
  // to encrypted storage on launch, without requiring the GM to open Settings first.
  await Promise.all([
    scenes.list(),
    appConfig.get('discord.token'),
    visionSettings.get(),
    sounds.list('music'),
  ]).catch((err) => {
    log.error('Storage warm-up failed:', err)
  })
  log.info('Services ready; Discord login scheduled')

  // Defer login to avoid blocking app startup
  // Discord will connect in background after main window shows
  setImmediate(() => {
    discord.login().catch((err) => {
      log.error('Discord login failed:', err)
    })
  })

  const api: EmbeddedApi = {
    player: {
      getState: () => player.getState(),
      getBotStatus: () => discord.getBotStatus(),
      getGuildDirectory: () => discord.listGuildDirectory(),
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
      startStream: (guildId, stream, metadata, streamId) =>
        player.startStream(guildId, stream as import('node:stream').Readable, metadata as import('./player/player').TrackMetadata | undefined, streamId),
      startEffectStream: (guildId, stream, streamId, volume) =>
        player.startEffectStream(guildId, stream as import('node:stream').Readable, streamId, volume),
      setEffectStreamVolume: (guildId, streamId, volume) => player.setEffectStreamVolume(guildId, streamId, volume),
      stopStream: (guildId, streamId) => player.stopStream(guildId, streamId),
      reportLocalSinkHealth: event => player.reportLocalSinkHealth(event),
      playMusic: (guildId, soundId, options) => player.playMusic(guildId, soundId, options),
      stopMusic: (guildId, options) => player.stopMusic(guildId, options),
      setMusicVolume: (guildId, volume, options) => player.setMusicVolume(guildId, volume, options),
      playAmbience: (guildId, soundId, options) => player.playAmbience(guildId, soundId, options),
      stopAmbience: (guildId, soundId, options) => player.stopAmbience(guildId, soundId, options),
      setAmbienceVolume: (guildId, soundId, volume, options) => player.setAmbienceVolume(guildId, soundId, volume, options),
      playEffect: (guildId, soundId, options) => player.playEffect(guildId, soundId, options),
      stopEffects: guildId => player.stopEffects(guildId),
      stopEffect: (guildId, instanceId) => player.stopEffect(guildId, instanceId),
      reconnect: () => discord.reconnect(),
    },
    config: {
      getDiscord: () => getDiscordStatus(),
      setDiscordToken: async (token) => {
        if (typeof token === 'string' && token.trim())
          await appConfig.set('discord.token', token.trim())
        return getDiscordStatus()
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
      getSceneFadeLength: async () => parseSceneFadeLength(await appConfig.get('scene.fadeLength')),
      setSceneFadeLength: async (seconds) => {
        await appConfig.set('scene.fadeLength', JSON.stringify(normalizeSceneFadeLength(seconds)))
      },
      getActiveOutputTarget: () => outputTargets.getActive(),
      setActiveOutputTarget: kind => outputTargets.setActive(kind),
      getLocalOutputDevice: () => localOutputDevice.get(),
      setLocalOutputDevice: device => localOutputDevice.set(device),
      getMasterVolume: targetId => outputTargets.getMasterVolume(targetKind(targetId)),
      setMasterVolume: (targetId, volume) => outputTargets.setMasterVolume(targetKind(targetId), volume),
      getHotkeySettings: () => hotkeySettings.get(),
      setHotkeySettings: settings => hotkeySettings.set(settings),
      getVision: () => visionSettings.get(),
      setVisionProvider: provider => visionSettings.setProvider(provider),
      setVisionApiKey: (provider, apiKey) => visionSettings.setApiKey(provider, apiKey),
      setVisionOpenAiBaseUrl: baseUrl => visionSettings.setOpenAiBaseUrl(baseUrl),
      setVisionOpenAiModel: model => visionSettings.setOpenAiModel(model),
      setVisionEnabled: enabled => visionSettings.setEnabled(enabled),
      getStorageWarnings: async () => getStorageWarnings(),
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
      canDecode: (type, id) => sounds.canDecode(type, id),
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
        const { enabled, configured } = await visionSettings.get()
        if (!enabled)
          throw new Error('Vision to Vibe is turned off. Enable it in Settings first.')
        if (!configured)
          throw new Error('The selected Vision Provider is not configured. Add it in Settings first.')
        return vision.analyzeImageVibe(imagePath)
      },
      matchVibe: async (vibeTags) => {
        const [music, ambience] = await Promise.all([sounds.list('music'), sounds.list('ambience')])
        return matchVibeLibrary(vibeTags, { music, ambience })
      },
    },
    updates: {
      getSettings: () => updateCheck.getSettings(),
      setEnabled: enabled => updateCheck.setEnabled(enabled),
      check: () => updateCheck.check(),
      dismiss: version => updateCheck.dismiss(version),
    },
  }

  return {
    close: createShutdownHandler(player, discord),
    api,
    onPlayerStateChanged: player.onStateChanged,
  }
}
