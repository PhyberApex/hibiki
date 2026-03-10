import type { DiscordGatewayAdapterCreator, VoiceConnection } from '@discordjs/voice'
import type { VoiceBasedChannel } from 'discord.js'
import type { Readable } from 'node:stream'
import type { SoundCategory } from '../sound/sound.types'
import {
  AudioPlayerStatus,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  VoiceConnectionStatus,
} from '@discordjs/voice'
import { AudioEngine } from './audio-engine'

interface TrackMetadata {
  id: string
  name: string
  filename: string
  category: SoundCategory
}

export class GuildAudioManager {
  private connection?: VoiceConnection
  private readonly engine = new AudioEngine()
  private channelName?: string
  private currentTrack?: TrackMetadata

  constructor(private readonly guildId: string) {}

  async connect(channel: VoiceBasedChannel) {
    if (
      this.connection
      && this.connection.joinConfig.channelId === channel.id
    ) {
      this.channelName = channel.name
      return this.connection
    }

    this.connection?.destroy()
    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: false,
    })
    this.channelName = channel.name

    this.connection.on('error', (error) => {
      console.error(`[GuildAudioManager] VoiceConnection error (guild ${this.guildId}):`, error.message)
    })
    this.connection.on('stateChange', (oldState, newState) => {
      console.warn(`[GuildAudioManager] VoiceConnection state: ${oldState.status} -> ${newState.status} (guild ${this.guildId})`)
    })
    this.connection.subscribe(this.engine.audioPlayer)
    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000)
    return this.connection
  }

  disconnect() {
    this.stopMusic()
    getVoiceConnection(this.guildId)?.destroy()
    this.connection = undefined
    this.channelName = undefined
  }

  destroy() {
    this.stopMusic()
    this.connection?.destroy()
    this.connection = undefined
    this.engine.destroy()
  }

  playMusicFromStream(stream: Readable, metadata?: TrackMetadata) {
    this.currentTrack = metadata
    stream.once('end', () => {
      this.currentTrack = undefined
    })
    stream.once('error', () => {
      this.currentTrack = undefined
    })
    this.engine.playMusicFromStream(stream)
  }

  stopMusic() {
    this.currentTrack = undefined
    this.engine.stopMusic()
  }

  playEffectFromStream(stream: Readable) {
    this.engine.playEffectFromStream(stream)
  }

  get isIdle() {
    return this.engine.audioPlayer.state.status === AudioPlayerStatus.Idle
  }

  get channelId() {
    return this.connection?.joinConfig.channelId
  }

  get channelLabel() {
    return this.channelName
  }

  get track() {
    return this.currentTrack
  }

  get connected() {
    return Boolean(this.connection)
  }

  getVolumes(): { music: number, effects: number } {
    return this.engine.getVolumes()
  }

  setVolumes(updates: { music?: number, effects?: number }): void {
    this.engine.setVolumes(updates)
  }
}
