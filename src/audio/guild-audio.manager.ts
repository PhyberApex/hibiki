import type { DiscordGatewayAdapterCreator, VoiceConnection } from '@discordjs/voice'
import type { VoiceBasedChannel } from 'discord.js'
import type { Readable } from 'node:stream'
import type { SoundCategory } from '../sound/sound.types'
import { EventEmitter } from 'node:events'
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

const RECONNECT_GRACE_PERIOD_MS = 5_000

interface MusicStreamEntry {
  metadata?: TrackMetadata
  seq: number
}

export class GuildAudioManager extends EventEmitter {
  private connection?: VoiceConnection
  private readonly engine = new AudioEngine()
  private channelName?: string
  /** Bookkeeping for current-track reporting; keyed the same way as the engine's music streams. */
  private readonly musicStreams = new Map<string | undefined, MusicStreamEntry>()
  private musicStreamSeq = 0
  /**
   * Set while this manager is itself tearing down a connection, so the
   * resulting Destroyed stateChange doesn't re-trigger teardown handling.
   */
  private intentionalTeardown = false

  constructor(private readonly guildId: string) {
    super()
  }

  async connect(channel: VoiceBasedChannel) {
    if (
      this.connection
      && this.connection.joinConfig.channelId === channel.id
    ) {
      this.channelName = channel.name
      return this.connection
    }

    this.destroyConnection()

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: false,
    })
    this.connection = connection
    this.channelName = channel.name

    connection.on('error', (error) => {
      console.error(`[GuildAudioManager] VoiceConnection error (guild ${this.guildId}):`, error.message)
    })
    connection.on('stateChange', (oldState, newState) => {
      console.warn(`[GuildAudioManager] VoiceConnection state: ${oldState.status} -> ${newState.status} (guild ${this.guildId})`)
      if (newState.status === VoiceConnectionStatus.Disconnected)
        this.handleDisconnect(connection)
      if (newState.status === VoiceConnectionStatus.Destroyed)
        this.handleTeardown(connection)
    })
    connection.subscribe(this.engine.audioPlayer)
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000)
    return connection
  }

  /**
   * Standard discord.js reconnect pattern: give Discord's own reconnect a
   * 5s grace period to re-enter Signalling or Connecting; otherwise the
   * connection is treated as dead and torn down.
   */
  private async handleDisconnect(connection: VoiceConnection) {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, RECONNECT_GRACE_PERIOD_MS),
        entersState(connection, VoiceConnectionStatus.Connecting, RECONNECT_GRACE_PERIOD_MS),
      ])
    }
    catch {
      if (this.connection !== connection)
        return
      try {
        connection.destroy()
      }
      catch {
        // Already destroyed by another path; nothing left to tear down.
      }
    }
  }

  /**
   * Fires for any Destroyed transition that this manager didn't initiate
   * itself (grace-period expiry, or the connection being destroyed from
   * outside), so callers can clean up the same way either path.
   */
  private handleTeardown(connection: VoiceConnection) {
    if (this.connection !== connection || this.intentionalTeardown)
      return
    this.stopAllMusic()
    this.connection = undefined
    this.channelName = undefined
    this.emit('disconnected')
  }

  /**
   * Runs `action` with `intentionalTeardown` set, so a resulting Destroyed
   * stateChange is suppressed instead of being treated as an external kill.
   */
  private withIntentionalTeardown(action: () => void): void {
    this.intentionalTeardown = true
    action()
    this.intentionalTeardown = false
  }

  private destroyConnection() {
    if (!this.connection)
      return
    this.withIntentionalTeardown(() => this.connection!.destroy())
  }

  disconnect() {
    this.stopAllMusic()
    this.withIntentionalTeardown(() => getVoiceConnection(this.guildId)?.destroy())
    this.connection = undefined
    this.channelName = undefined
  }

  destroy() {
    this.stopAllMusic()
    this.withIntentionalTeardown(() => this.connection?.destroy())
    this.connection = undefined
    this.engine.destroy()
  }

  /**
   * Starts a music stream under `streamId` (or the default slot when
   * omitted). An existing stream under the same id is replaced, same as a
   * plain restart; other ids are left playing.
   */
  playMusicFromStream(stream: Readable, metadata?: TrackMetadata, streamId?: string) {
    const seq = ++this.musicStreamSeq
    this.musicStreams.set(streamId, { metadata, seq })
    const clearEntry = () => {
      if (this.musicStreams.get(streamId)?.seq === seq)
        this.musicStreams.delete(streamId)
    }
    stream.once('end', clearEntry)
    stream.once('error', clearEntry)
    this.engine.playMusicFromStream(stream, streamId)
  }

  /** Ends the music stream for `streamId` (or the default slot when omitted). Other ids keep playing. */
  stopMusic(streamId?: string) {
    this.musicStreams.delete(streamId)
    this.engine.stopMusic(streamId)
  }

  /** Ends every music stream for this guild, regardless of id. */
  stopAllMusic() {
    this.musicStreams.clear()
    this.engine.stopAllMusic()
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

  /** The most recently started music stream that is still alive; undefined once none are left. */
  get track(): TrackMetadata | undefined {
    let latest: MusicStreamEntry | undefined
    for (const entry of this.musicStreams.values()) {
      if (!latest || entry.seq > latest.seq)
        latest = entry
    }
    return latest?.metadata
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
