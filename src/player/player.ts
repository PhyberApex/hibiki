import type { VoiceBasedChannel } from 'discord.js'
import type { Readable } from 'node:stream'
import type { EffectInstanceInfo, PlayAmbienceOptions, PlayEffectOptions, PlayMusicOptions } from '../audio/guild-audio.manager'
import type { LocalSink } from '../audio/local-sink-pump'
import type { DiscordClient } from '../discord/discord-client'
import type { SoundLibrary } from '../sound/sound-library'
import type { SoundCategory } from '../sound/sound.types'
import type { GuildPlaybackState } from './player.types'
import { EventEmitter } from 'node:events'
import { getVoiceConnection } from '@discordjs/voice'
import { createPcmStream } from '../audio/decoders'
import { createEffectPcmCache } from '../audio/decoders/effect-pcm-cache'
import { GuildAudioManager } from '../audio/guild-audio.manager'
import { createLogger } from '../logger'
import { isLocalTarget, LOCAL_TARGET_ID, targetKind } from './output-target'

const log = createLogger('player')

export interface TrackMetadata {
  id: string
  name: string
  filename: string
  category: SoundCategory
}

/** Health events the renderer's Local sink reports over IPC (ADR-0004). */
export type LocalSinkHealth
  = | { type: 'started', sampleRate?: number }
    | { type: 'suspended' }
    | { type: 'resumed' }
    | { type: 'underruns', count: number }
    | { type: 'deviceLost', message?: string }
    | { type: 'failed', message?: string }

export interface PlayerOptions {
  /** Where the Local Target's mix goes; without one the Local Target cannot play. */
  localSink?: LocalSink
}

export function createPlayer(discord: DiscordClient, sounds: SoundLibrary, options: PlayerOptions = {}) {
  const managers = new Map<string, GuildAudioManager>()
  const stateEvents = new EventEmitter()
  /** Shared across every guild — the same Sound Library Effect file decodes identically regardless of which guild triggers it (see ADR-0003). */
  const effectPcmCache = createEffectPcmCache()

  function getOrCreateManager(guildId: string): GuildAudioManager {
    if (!managers.has(guildId)) {
      const manager = new GuildAudioManager(guildId, isLocalTarget(guildId)
        ? options.localSink
        : undefined)
      manager.on('disconnected', () => {
        managers.delete(guildId)
        stateEvents.emit('stateChanged')
      })
      manager.on('trackChanged', () => stateEvents.emit('stateChanged'))
      manager.on('ambienceChanged', () => stateEvents.emit('stateChanged'))
      manager.on('effectsChanged', () => stateEvents.emit('stateChanged'))
      managers.set(guildId, manager)
    }
    return managers.get(guildId)!
  }

  /**
   * The manager a playback call addressed to `targetId` runs on. The Local
   * Target needs no voice connection: its manager is created on first use and
   * is always "connected" as long as a sink exists. A Discord Target must
   * already be joined.
   */
  function requireManager(targetId: string, action: string): GuildAudioManager {
    if (isLocalTarget(targetId)) {
      if (!options.localSink) {
        log.warn(`${action} refused for the Local Target: no local sink is available`)
        throw new Error('Local output is not available.')
      }
      return getOrCreateManager(targetId)
    }
    const manager = managers.get(targetId)
    if (!manager || !manager.connected) {
      log.warn(`${action} refused for guild ${targetId}: not connected`)
      throw new Error('Not connected to a voice channel. Join first.')
    }
    return manager
  }

  /** The renderer's Local sink reported its health; a dead sink stops local playback (it would otherwise mix into silence). */
  function reportLocalSinkHealth(event: LocalSinkHealth): void {
    switch (event.type) {
      case 'started':
        log.info(`Local sink started in the renderer${event.sampleRate
          ? ` (AudioContext ${event.sampleRate} Hz)`
          : ''}`)
        break
      case 'suspended':
        log.warn('Local sink AudioContext suspended: local audio is silent until it resumes')
        break
      case 'resumed':
        log.info('Local sink AudioContext resumed')
        break
      case 'underruns':
        log.warn(`Local sink underran ${event.count} time${event.count === 1
          ? ''
          : 's'} in the last report interval`)
        break
      case 'deviceLost':
      case 'failed':
        managers.get(LOCAL_TARGET_ID)?.handleSinkDead(`${event.type}${event.message
          ? `: ${event.message}`
          : ''}`)
        if (!managers.has(LOCAL_TARGET_ID)) {
          log.error(`Local sink ${event.type}${event.message
            ? `: ${event.message}`
            : ''} (nothing was playing)`)
        }
        break
    }
  }

  async function connect(channel: VoiceBasedChannel): Promise<void> {
    log.info(`Joining ${channel.name} in ${channel.guild.name}`)
    const manager = getOrCreateManager(channel.guild.id)
    await manager.connect(channel)
  }

  async function disconnect(guildId: string): Promise<void> {
    if (!guildId)
      return
    if (isLocalTarget(guildId)) {
      log.warn('disconnect addressed to the Local Target ignored: it has no voice connection')
      return
    }
    log.info(`Disconnecting from guild ${guildId}`)
    const manager = managers.get(guildId)
    if (manager) {
      // manager.disconnect() destroys the connection itself, under its own
      // intentional-teardown guard — destroying it here first would fire the
      // Destroyed stateChange before the guard is up, deleting the manager
      // out from under this function and emitting a spurious 'disconnected'.
      manager.disconnect()
      managers.delete(guildId)
      return
    }
    const connection = getVoiceConnection(guildId)
    if (connection)
      connection.destroy()
    else
      await discord.leaveVoiceChannel(guildId)
  }

  async function stop(guildId: string): Promise<void> {
    const manager = managers.get(guildId)
    if (!manager)
      return
    log.info(`Stopping everything in guild ${guildId}`)
    manager.stopAllMusic()
    manager.stopAllAmbience()
    manager.stopAllEffects()
  }

  /** Starts a raw chunked-IPC music stream. Returns whether the stream reached a mixer (`false` on the Local Target). */
  function startStream(
    guildId: string,
    stream: Readable,
    metadata?: TrackMetadata,
    streamId?: string,
  ): boolean {
    if (isLocalTarget(guildId)) {
      // Renderer-native sources bypass the mix under the Local Target (ADR-0004).
      log.warn('startStream addressed to the Local Target ignored: renderer-native sources play locally')
      return false
    }
    const manager = managers.get(guildId)
    if (!manager || !manager.connected) {
      log.warn(`startStream refused for guild ${guildId}: not connected`)
      throw new Error('Not connected to a voice channel. Join first.')
    }
    log.info(`Renderer music stream ${streamId ?? '(default)'} started in guild ${guildId}${metadata
      ? ` for "${metadata.name}"`
      : ''}`)
    manager.playMusicFromStream(stream, metadata, streamId)
    return true
  }

  /**
   * Starts a raw chunked-IPC effect stream. With a `streamId` the stream
   * stays addressable for `setEffectStreamVolume` (a Routed Tab); without
   * one it is fire-and-forget. `volume` is the absolute initial level.
   * Returns whether the stream reached a mixer (`false` on the Local Target).
   */
  function startEffectStream(guildId: string, stream: Readable, streamId?: string, volume?: number): boolean {
    if (isLocalTarget(guildId)) {
      log.warn('startEffectStream addressed to the Local Target ignored: renderer-native sources play locally')
      return false
    }
    const manager = managers.get(guildId)
    if (!manager || !manager.connected) {
      log.warn(`startEffectStream refused for guild ${guildId}: not connected`)
      throw new Error('Not connected to a voice channel. Join first.')
    }
    log.info(`Renderer effect stream ${streamId ?? '(anonymous)'} started in guild ${guildId}${volume !== undefined
      ? ` at volume ${volume}`
      : ''}`)
    manager.playEffectFromStream(stream, streamId, volume)
    return true
  }

  /** Sets a keyed chunked-IPC effect stream's volume live. A logged no-op on the Local Target (the renderer plays those itself) or for a guild without a manager. */
  function setEffectStreamVolume(guildId: string, streamId: string, volume: number): void {
    if (isLocalTarget(guildId)) {
      log.debug(`setEffectStreamVolume ${streamId} addressed to the Local Target ignored: renderer-native sources play locally`)
      return
    }
    const manager = managers.get(guildId)
    if (!manager) {
      log.debug(`setEffectStreamVolume ${streamId} ignored: no manager for guild ${guildId}`)
      return
    }
    log.debug(`Renderer effect stream ${streamId} volume ${volume} in guild ${guildId}`)
    manager.setEffectStreamVolume(streamId, volume)
  }

  /** Stops a raw chunked-IPC music stream (Browser tab / renderer fallback) — not the backend-decoded track; see `stopMusic` below for that. */
  function stopStream(guildId: string, streamId?: string): void {
    const manager = managers.get(guildId)
    if (!manager)
      return
    log.info(`Renderer music stream ${streamId ?? '(default)'} stopped in guild ${guildId}`)
    manager.stopMusic(streamId)
  }

  /** Plays a Sound Library Music track decoded straight into the mixer (see ADR-0003). */
  async function playMusic(guildId: string, soundId: string, options: PlayMusicOptions): Promise<void> {
    const manager = requireManager(guildId, 'playMusic')
    const file = await sounds.getFile('music', soundId)
    log.info(`playMusic "${file.name}" (${file.filename}) in guild ${guildId}: volume ${options.volume}, loop ${options.loop ?? false}, fadeIn ${options.fadeInMs ?? 0} ms`)
    await manager.playMusic(
      () => createPcmStream(file.path),
      {
        id: file.id,
        name: file.name,
        filename: file.filename,
        category: file.category,
      },
      options,
    )
  }

  /** Stops the currently playing backend-decoded Music track (started via `playMusic` above), if any — distinct from `stopStream`'s chunked-IPC path. */
  function stopMusic(guildId: string, options: { fadeOutMs?: number } = {}): void {
    log.info(`stopMusic in guild ${guildId}, fadeOut ${options.fadeOutMs ?? 0} ms`)
    managers.get(guildId)?.stopCurrentTrack(options)
  }

  /** Changes the currently playing backend-decoded Music track's volume, if any. */
  function setMusicVolume(guildId: string, volume: number, options: { rampMs?: number } = {}): void {
    const manager = managers.get(guildId)
    if (!manager)
      throw new Error('No player for this guild. Join a voice channel first.')
    log.debug(`setMusicVolume ${volume} in guild ${guildId}, ramp ${options.rampMs ?? 0} ms`)
    manager.setMusicVolume(volume, options)
  }

  /** Plays a Sound Library Ambience sound decoded straight into the mixer (see ADR-0003). Several can be active at once per guild, keyed by soundId. */
  async function playAmbience(guildId: string, soundId: string, options: PlayAmbienceOptions): Promise<void> {
    const manager = requireManager(guildId, 'playAmbience')
    const file = await sounds.getFile('ambience', soundId)
    log.info(`playAmbience "${file.name}" (${file.filename}) in guild ${guildId}: volume ${options.volume}, repeat ${options.repeatMin}-${options.repeatMax} s, fadeIn ${options.fadeInMs ?? 0} ms`)
    await manager.playAmbience(() => createPcmStream(file.path), soundId, options)
  }

  /** Stops a backend-decoded Ambience sound (started via `playAmbience` above), if playing. */
  function stopAmbience(guildId: string, soundId: string, options: { fadeOutMs?: number } = {}): void {
    log.info(`stopAmbience ${soundId} in guild ${guildId}, fadeOut ${options.fadeOutMs ?? 0} ms`)
    managers.get(guildId)?.stopAmbience(soundId, options)
  }

  /** Changes a backend-decoded Ambience sound's volume, if playing. */
  function setAmbienceVolume(guildId: string, soundId: string, volume: number, options: { rampMs?: number } = {}): void {
    const manager = managers.get(guildId)
    if (!manager)
      throw new Error('No player for this guild. Join a voice channel first.')
    log.debug(`setAmbienceVolume ${soundId} -> ${volume} in guild ${guildId}, ramp ${options.rampMs ?? 0} ms`)
    manager.setAmbienceVolume(soundId, volume, options)
  }

  /**
   * Plays a Sound Library Effect decoded straight into the mixer (see
   * ADR-0003); every trigger is its own instance, and the same Effect can
   * layer. Recently used Effects are served from an in-memory PCM cache
   * (`effectPcmCache`) to keep trigger latency low despite a fresh decoder
   * instance otherwise being spun up on every single trigger — `getFilePath`
   * (just a glob + path join) rather than `getFile` (which also stats the
   * file and reads the tags store) for the same reason: every trigger would
   * otherwise pay that I/O even on a PCM cache hit, undercutting the cache's
   * whole point, and nothing but the path is needed here.
   */
  async function playEffect(guildId: string, soundId: string, options: PlayEffectOptions): Promise<EffectInstanceInfo | undefined> {
    const manager = requireManager(guildId, 'playEffect')
    const path = await sounds.getFilePath('effects', soundId)
    log.info(`playEffect ${soundId} in guild ${guildId}: volume ${options.volume}`)
    return manager.playEffect(() => effectPcmCache.get(path, () => createPcmStream(path)), soundId, options)
  }

  /** Ends every backend-decoded Effect instance for this guild (distinct from the chunked-IPC `audio:stopEffectStream` path). */
  function stopEffects(guildId: string): void {
    log.info(`stopEffects in guild ${guildId}`)
    managers.get(guildId)?.stopAllEffects()
  }

  /** Ends one backend-decoded Effect Instance by id (#509), leaving every other instance untouched; a no-op without a manager for this guild. */
  function stopEffect(guildId: string, instanceId: string): void {
    log.info(`stopEffect ${instanceId} in guild ${guildId}`)
    managers.get(guildId)?.stopEffect(instanceId)
  }

  function getLiveState(): GuildPlaybackState[] {
    const timestamp = new Date().toISOString()
    return Array.from(managers.entries()).map(([guildId, manager]) => ({
      targetId: guildId,
      kind: targetKind(guildId),
      guildId,
      connectedChannelId: manager.channelId ?? undefined,
      connectedChannelName: manager.channelLabel,
      isIdle: manager.isIdle,
      track: manager.track ?? null,
      source: 'live' as const,
      lastUpdated: timestamp,
      ambience: manager.activeAmbience,
      effects: manager.activeEffects,
    }))
  }

  async function getState(): Promise<GuildPlaybackState[]> {
    const live = getLiveState()
    const liveGuildIds = new Set(live.map(s => s.guildId))
    const now = new Date().toISOString()
    const discordFallbacks: GuildPlaybackState[] = []
    for (const guild of discord.listGuildDirectory()) {
      if (liveGuildIds.has(guild.guildId))
        continue
      const voice = discord.getBotVoiceStateForGuild(guild.guildId)
      if (voice.channelId) {
        discordFallbacks.push({
          targetId: guild.guildId,
          kind: 'discord',
          guildId: guild.guildId,
          connectedChannelId: voice.channelId,
          connectedChannelName: voice.channelName ?? undefined,
          isIdle: true,
          track: null,
          source: 'discord',
          lastUpdated: now,
        })
      }
    }
    return [
      ...live,
      ...discordFallbacks,
    ]
  }

  function onStateChanged(listener: () => void): () => void {
    stateEvents.on('stateChanged', listener)
    return () => stateEvents.off('stateChanged', listener)
  }

  /**
   * Tears down every connected guild's voice state (used on app shutdown —
   * see `bootstrap-embedded.ts`'s `close()`). Each manager's own `destroy()`
   * already guards against emitting a spurious `disconnected` event for
   * intentional teardown, so clearing the map directly here (rather than
   * going through the `disconnected` listener) is just bookkeeping, not a
   * race. One manager throwing during teardown must not stop the rest.
   */
  async function destroyAll(): Promise<void> {
    const toDestroy = [
      ...managers.values(),
    ]
    managers.clear()
    await Promise.all(toDestroy.map(async (manager) => {
      try {
        manager.destroy()
      }
      catch (err) {
        log.error('Failed to destroy guild audio manager during shutdown:', err)
      }
    }))
  }

  /** Leaves voice in every Discord guild (the Discord token was removed); the Local Target keeps playing. */
  async function disconnectAllVoice(): Promise<void> {
    const guildIds = [
      ...managers.keys(),
    ].filter(id => !isLocalTarget(id))
    log.info(`Leaving voice in ${guildIds.length} guild(s)`)
    for (const guildId of guildIds) {
      try {
        await disconnect(guildId)
      }
      catch (err) {
        log.error(`Failed to leave voice in guild ${guildId}:`, err)
      }
    }
    if (guildIds.length)
      stateEvents.emit('stateChanged')
  }

  return {
    connect,
    disconnect,
    disconnectAllVoice,
    stop,
    startStream,
    startEffectStream,
    setEffectStreamVolume,
    stopStream,
    playMusic,
    stopMusic,
    setMusicVolume,
    playAmbience,
    stopAmbience,
    setAmbienceVolume,
    playEffect,
    stopEffects,
    stopEffect,
    reportLocalSinkHealth,
    getState,
    onStateChanged,
    destroyAll,
  }
}
