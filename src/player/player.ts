import type { VoiceBasedChannel } from 'discord.js'
import type { Readable } from 'node:stream'
import type { PlayMusicOptions } from '../audio/guild-audio.manager'
import type { DiscordClient } from '../discord/discord-client'
import type { SoundLibrary } from '../sound/sound-library'
import type { SoundCategory } from '../sound/sound.types'
import type { GuildPlaybackState } from './player.types'
import { EventEmitter } from 'node:events'
import { getVoiceConnection } from '@discordjs/voice'
import { createPcmStream } from '../audio/decoders'
import { GuildAudioManager } from '../audio/guild-audio.manager'
import { createLogger } from '../logger'

const log = createLogger('player')

export interface TrackMetadata {
  id: string
  name: string
  filename: string
  category: SoundCategory
}

export function createPlayer(discord: DiscordClient, sounds: SoundLibrary) {
  const managers = new Map<string, GuildAudioManager>()
  const stateEvents = new EventEmitter()

  function getOrCreateManager(guildId: string): GuildAudioManager {
    if (!managers.has(guildId)) {
      const manager = new GuildAudioManager(guildId)
      manager.on('disconnected', () => {
        managers.delete(guildId)
        stateEvents.emit('stateChanged')
      })
      manager.on('trackChanged', () => stateEvents.emit('stateChanged'))
      managers.set(guildId, manager)
    }
    return managers.get(guildId)!
  }

  async function connect(channel: VoiceBasedChannel): Promise<void> {
    log.info(`Joining ${channel.name} in ${channel.guild.name}`)
    const manager = getOrCreateManager(channel.guild.id)
    await manager.connect(channel)
  }

  async function disconnect(guildId: string): Promise<void> {
    if (!guildId)
      return
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
    manager.stopAllMusic()
  }

  function startStream(
    guildId: string,
    stream: Readable,
    metadata?: TrackMetadata,
    streamId?: string,
  ): void {
    const manager = managers.get(guildId)
    if (!manager)
      throw new Error('Not connected to a voice channel. Join first.')
    if (!manager.connected)
      throw new Error('Not connected to a voice channel. Join first.')
    manager.playMusicFromStream(stream, metadata, streamId)
  }

  function startEffectStream(guildId: string, stream: Readable): void {
    const manager = managers.get(guildId)
    if (!manager)
      throw new Error('Not connected to a voice channel. Join first.')
    if (!manager.connected)
      throw new Error('Not connected to a voice channel. Join first.')
    manager.playEffectFromStream(stream)
  }

  /** Stops a raw chunked-IPC music stream (Browser tab / renderer fallback) — not the backend-decoded track; see `stopMusic` below for that. */
  function stopStream(guildId: string, streamId?: string): void {
    const manager = managers.get(guildId)
    if (manager)
      manager.stopMusic(streamId)
  }

  /** Plays a Sound Library Music track decoded straight into the mixer (see ADR-0003). */
  async function playMusic(guildId: string, soundId: string, options: PlayMusicOptions): Promise<void> {
    const manager = managers.get(guildId)
    if (!manager || !manager.connected)
      throw new Error('Not connected to a voice channel. Join first.')
    const file = await sounds.getFile('music', soundId)
    await manager.playMusic(
      () => createPcmStream(file.path),
      { id: file.id, name: file.name, filename: file.filename, category: file.category },
      options,
    )
  }

  /** Stops the currently playing backend-decoded Music track (started via `playMusic` above), if any — distinct from `stopStream`'s chunked-IPC path. */
  function stopMusic(guildId: string, options: { fadeOutMs?: number } = {}): void {
    managers.get(guildId)?.stopCurrentTrack(options)
  }

  /** Changes the currently playing backend-decoded Music track's volume, if any. */
  function setMusicVolume(guildId: string, volume: number, options: { rampMs?: number } = {}): void {
    const manager = managers.get(guildId)
    if (!manager)
      throw new Error('No player for this guild. Join a voice channel first.')
    manager.setMusicVolume(volume, options)
  }

  function getLiveState(): GuildPlaybackState[] {
    const timestamp = new Date().toISOString()
    return Array.from(managers.entries()).map(([guildId, manager]) => ({
      guildId,
      connectedChannelId: manager.channelId ?? undefined,
      connectedChannelName: manager.channelLabel,
      isIdle: manager.isIdle,
      track: manager.track ?? null,
      source: 'live' as const,
      lastUpdated: timestamp,
      volume: manager.getVolumes(),
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
    return [...live, ...discordFallbacks]
  }

  function getVolume(guildId: string): { music: number, effects: number } | null {
    return managers.get(guildId)?.getVolumes() ?? null
  }

  function setVolume(guildId: string, updates: { music?: number, effects?: number }): { music: number, effects: number } {
    const manager = managers.get(guildId)
    if (!manager)
      throw new Error('No player for this guild. Join a voice channel first.')
    manager.setVolumes(updates)
    return manager.getVolumes()
  }

  function onStateChanged(listener: () => void): () => void {
    stateEvents.on('stateChanged', listener)
    return () => stateEvents.off('stateChanged', listener)
  }

  return {
    connect,
    disconnect,
    stop,
    startStream,
    startEffectStream,
    stopStream,
    playMusic,
    stopMusic,
    setMusicVolume,
    getState,
    getVolume,
    setVolume,
    onStateChanged,
  }
}
