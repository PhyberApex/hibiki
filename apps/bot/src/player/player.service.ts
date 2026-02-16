import { getVoiceConnection } from '@discordjs/voice'
import type { VoiceBasedChannel } from 'discord.js'
import type { SoundCategory } from '../sound/sound.types'
import type { GuildPlaybackState } from './player.types'
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common'
import { GuildAudioManager } from '../audio/guild-audio.manager'
import { DiscordService } from '../discord/discord.service'
import { PlayerSnapshotService } from '../persistence/player-snapshot.service'
import { SoundLibraryService } from '../sound/sound.service'

interface SnapshotOverrides {
  trackId: string | null
  trackName: string | null
  trackFilename: string | null
  trackCategory: SoundCategory | null
  isIdle: boolean
}

@Injectable()
export class PlayerService {
  private readonly logger = new Logger(PlayerService.name)
  private readonly managers = new Map<string, GuildAudioManager>()

  constructor(
    @Inject(SoundLibraryService) private readonly sounds: SoundLibraryService,
    @Inject(PlayerSnapshotService) private readonly snapshots: PlayerSnapshotService,
    @Inject(forwardRef(() => DiscordService)) private readonly discord: DiscordService,
  ) {}

  async connect(channel: VoiceBasedChannel) {
    const manager = this.getOrCreateManager(channel.guild.id)
    await manager.connect(channel)
    this.logger.log(`Connected to ${channel.guild.name}#${channel.name}`)
    await this.persistManagerState(channel.guild.id)
    return manager
  }

  async disconnect(guildId: string) {
    if (!guildId) {
      this.logger.warn('disconnect called with empty guildId')
      return
    }
    const connection = getVoiceConnection(guildId)
    if (connection) {
      connection.destroy()
      this.logger.log(`Destroyed voice connection for guild ${guildId}`)
    }
    else {
      this.logger.log(`disconnect ${guildId}: no in-process voice connection (e.g. after restart), requesting leave via Discord API`)
      const left = await this.discord.leaveVoiceChannel(guildId)
      if (!left) {
        this.logger.warn(`disconnect ${guildId}: Discord API leave returned false (client not ready, guild not in cache, or bot not in voice)`)
      }
    }
    const manager = this.managers.get(guildId)
    if (manager) {
      manager.disconnect()
      this.managers.delete(guildId)
    }
    await this.snapshots.remove(guildId)
    this.logger.log(`Disconnected from guild ${guildId}`)
  }

  async stop(guildId: string) {
    const manager = this.managers.get(guildId)
    if (!manager) {
      this.logger.debug(`Stop guild ${guildId}: no manager`)
      return
    }
    manager.stopMusic()
    await this.persistManagerState(guildId)
    this.logger.log(`Stopped playback on guild ${guildId}`)
  }

  async playMusic(
    guildId: string,
    trackIdOrName: string,
    channel?: VoiceBasedChannel,
  ) {
    const manager = await this.resolveManager(guildId, channel)
    const file = await this.sounds.getFileByIdOrName('music', trackIdOrName)
    manager.playMusic(file.path, {
      id: file.id,
      name: file.name,
      filename: file.filename,
      category: file.category,
    })
    this.logger.log(`Playing music '${file.name}' on guild ${guildId}`)
    await this.persistManagerState(guildId, {
      trackId: file.id,
      trackName: file.name,
      trackFilename: file.filename,
      trackCategory: file.category,
      isIdle: false,
    })
    return file
  }

  async playEffect(
    guildId: string,
    effectIdOrName: string,
    channel?: VoiceBasedChannel,
  ) {
    const manager = await this.resolveManager(guildId, channel)
    const file = await this.sounds.getFileByIdOrName('effects', effectIdOrName)
    manager.playEffect(file.path)
    this.logger.log(`Triggered effect '${file.name}' on guild ${guildId}`)
    await this.persistManagerState(guildId, {
      trackId: file.id,
      trackName: file.name,
      trackFilename: file.filename,
      trackCategory: file.category,
      isIdle: false,
    })
    return file
  }

  async getState(): Promise<GuildPlaybackState[]> {
    const live = this.getLiveState()
    this.logger.debug(`getState: ${live.length} live guild(s)`)
    const liveGuilds = new Set(live.map(state => state.guildId))
    const snapshots = await this.snapshots.list()
    const persistedFallbacks: GuildPlaybackState[] = []
    for (const snapshot of snapshots) {
      if (liveGuilds.has(snapshot.guildId))
        continue
      const voice = this.discord.getBotVoiceStateForGuild(snapshot.guildId)
      if (!voice.channelId) {
        if (snapshot.connectedChannelId != null) {
          this.logger.debug(`Snapshot guild ${snapshot.guildId}: Discord says not in voice, correcting DB`)
          await this.snapshots.upsert({
            guildId: snapshot.guildId,
            connectedChannelId: null,
            connectedChannelName: null,
            trackId: null,
            trackName: null,
            trackFilename: null,
            trackCategory: null,
            isIdle: true,
          })
        }
        persistedFallbacks.push({
          guildId: snapshot.guildId,
          isIdle: true,
          track: null,
          source: 'snapshot',
          lastUpdated: snapshot.updatedAt.toISOString(),
        })
      }
      else {
        persistedFallbacks.push({
          guildId: snapshot.guildId,
          connectedChannelId: voice.channelId,
          connectedChannelName: voice.channelName ?? undefined,
          isIdle: snapshot.isIdle,
          track: snapshot.trackId
            ? {
                id: snapshot.trackId,
                name: snapshot.trackName ?? 'Unknown',
                filename: snapshot.trackFilename ?? 'unknown',
                category: snapshot.trackCategory ?? 'music',
              }
            : null,
          source: 'snapshot',
          lastUpdated: snapshot.updatedAt.toISOString(),
        })
      }
    }
    return [...live, ...persistedFallbacks]
  }

  getConnectedChannelId(guildId: string) {
    return this.managers.get(guildId)?.channelId
  }

  getVolume(guildId: string): { music: number, effects: number } | null {
    return this.managers.get(guildId)?.getVolumes() ?? null
  }

  setVolume(
    guildId: string,
    updates: { music?: number, effects?: number },
  ): void {
    const manager = this.managers.get(guildId)
    if (!manager) {
      throw new Error('No player for this guild. Join a voice channel first.')
    }
    manager.setVolumes(updates)
  }

  private getLiveState(): GuildPlaybackState[] {
    const timestamp = new Date().toISOString()
    return Array.from(this.managers.entries()).map(([guildId, manager]) => ({
      guildId,
      connectedChannelId: manager.channelId ?? undefined,
      connectedChannelName: manager.channelLabel,
      isIdle: manager.isIdle,
      track: manager.track ?? null,
      source: 'live',
      lastUpdated: timestamp,
      volume: manager.getVolumes(),
    }))
  }

  private async persistManagerState(
    guildId: string,
    overrides: Partial<SnapshotOverrides> = {},
  ) {
    const manager = this.managers.get(guildId)
    if (!manager) {
      await this.snapshots.remove(guildId)
      return
    }

    await this.snapshots.upsert({
      guildId,
      connectedChannelId: manager.channelId ?? null,
      connectedChannelName: manager.channelLabel ?? null,
      trackId: overrides.trackId ?? manager.track?.id ?? null,
      trackName: overrides.trackName ?? manager.track?.name ?? null,
      trackFilename: overrides.trackFilename ?? manager.track?.filename ?? null,
      trackCategory: overrides.trackCategory ?? manager.track?.category ?? null,
      isIdle: overrides.isIdle ?? manager.isIdle,
    })
  }

  private getOrCreateManager(guildId: string) {
    if (!this.managers.has(guildId)) {
      this.managers.set(guildId, new GuildAudioManager(guildId))
    }
    return this.managers.get(guildId)!
  }

  private async resolveManager(guildId: string, channel?: VoiceBasedChannel) {
    const manager = this.getOrCreateManager(guildId)
    if (channel) {
      this.logger.log(`Connecting to ${channel.guild.name}#${channel.name} for play/effect`)
      await manager.connect(channel)
      await this.persistManagerState(guildId)
      return manager
    }
    if (!manager.connected) {
      this.logger.warn(`resolveManager guild ${guildId}: not connected, no channel provided`)
      throw new Error(
        'Hibiki is not connected to a voice channel. Use join first.',
      )
    }
    return manager
  }
}
