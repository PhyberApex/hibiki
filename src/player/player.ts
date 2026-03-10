import type { VoiceBasedChannel } from 'discord.js'
import type { Readable } from 'node:stream'
import type { DiscordClient } from '../discord/discord-client'
import type { SoundCategory } from '../sound/sound.types'
import type { GuildPlaybackState } from './player.types'
import { getVoiceConnection } from '@discordjs/voice'
import { GuildAudioManager } from '../audio/guild-audio.manager'
import { createLogger } from '../logger'

const log = createLogger('player')

export interface TrackMetadata {
  id: string
  name: string
  filename: string
  category: SoundCategory
}

export function createPlayer(discord: DiscordClient) {
  const managers = new Map<string, GuildAudioManager>()

  function getOrCreateManager(guildId: string): GuildAudioManager {
    if (!managers.has(guildId))
      managers.set(guildId, new GuildAudioManager(guildId))
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
    const connection = getVoiceConnection(guildId)
    if (connection) {
      connection.destroy()
    }
    else {
      await discord.leaveVoiceChannel(guildId)
    }
    const manager = managers.get(guildId)
    if (manager) {
      manager.disconnect()
      managers.delete(guildId)
    }
  }

  async function stop(guildId: string): Promise<void> {
    const manager = managers.get(guildId)
    if (!manager)
      return
    manager.stopMusic()
  }

  function startStream(
    guildId: string,
    stream: Readable,
    metadata?: TrackMetadata,
  ): void {
    const manager = managers.get(guildId)
    if (!manager)
      throw new Error('Not connected to a voice channel. Join first.')
    if (!manager.connected)
      throw new Error('Not connected to a voice channel. Join first.')
    manager.playMusicFromStream(stream, metadata)
  }

  function startEffectStream(guildId: string, stream: Readable): void {
    const manager = managers.get(guildId)
    if (!manager)
      throw new Error('Not connected to a voice channel. Join first.')
    if (!manager.connected)
      throw new Error('Not connected to a voice channel. Join first.')
    manager.playEffectFromStream(stream)
  }

  function stopStream(guildId: string): void {
    const manager = managers.get(guildId)
    if (manager)
      manager.stopMusic()
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

  return {
    connect,
    disconnect,
    stop,
    startStream,
    startEffectStream,
    stopStream,
    getState,
    getVolume,
    setVolume,
  }
}
