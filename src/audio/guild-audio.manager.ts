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
  /** Only set for a track started via `playMusic` (the backend-decoded path); restarts the decoder stream on end. */
  loop?: boolean
}

export interface PlayMusicOptions {
  /** 0-100, the absolute volume to play this track at (see ADR-0003 — no master bus layered on top yet). */
  volume: number
  loop?: boolean
  /** Crossfades: the new track ramps in from 0 over this duration, while whatever was playing ramps out over the same duration instead of cutting. */
  fadeInMs?: number
}

export class GuildAudioManager extends EventEmitter {
  private connection?: VoiceConnection
  private readonly engine = new AudioEngine()
  private channelName?: string
  /** Bookkeeping for current-track reporting; keyed the same way as the engine's music streams. */
  private readonly musicStreams = new Map<string | undefined, MusicStreamEntry>()
  private musicStreamSeq = 0
  /**
   * The music-stream id most recently started via `playMusic` (the backend-
   * decoded path), or undefined once it's stopped/ended. Scoped separately
   * from the shared `musicStreams` bookkeeping above so that crossfading a
   * new backend track never reaches into a renderer-fallback stream (the
   * `audio:startStream` path) that happens to be sharing the same guild —
   * see CLAUDE.md's Backend Sound Library Playback section.
   */
  private backendTrackId?: string
  /**
   * Bumped at the start of every `playMusic`/`stopCurrentTrack` call and
   * captured by `playMusic` before it awaits the decoder. If another call
   * supersedes it before the decode resolves, the generation no longer
   * matches and the stale call aborts instead of committing — otherwise two
   * `playMusic` calls started close together (or a Stop issued mid-decode)
   * could both end up audible, or resurrect playback after Stop.
   */
  private musicGeneration = 0
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
    if (this.backendTrackId === streamId)
      this.backendTrackId = undefined
    this.engine.stopMusic(streamId)
  }

  /** Ends every music stream for this guild, regardless of id. */
  stopAllMusic() {
    this.musicStreams.clear()
    this.backendTrackId = undefined
    this.engine.stopAllMusic()
  }

  /**
   * Plays a Sound Library Music track decoded straight into the mixer (see
   * ADR-0003), replacing whatever backend track was playing. With
   * `fadeInMs`, the new track ramps in from 0 while the previous one ramps
   * out over the same duration instead of being cut — crossfade parity with
   * #409. `loop` restarts `streamFactory` at end of file; otherwise the
   * track clears once the file ends. Rejects (leaving any current track
   * untouched) if `streamFactory` fails on its first call. If superseded by
   * another `playMusic`/`stopCurrentTrack` call before the decode resolves,
   * this resolves without taking effect — the newer call wins.
   */
  async playMusic(
    streamFactory: () => Readable | Promise<Readable>,
    metadata: TrackMetadata,
    options: PlayMusicOptions,
  ): Promise<void> {
    const myGeneration = ++this.musicGeneration
    const outgoingStreamId = this.backendTrackId
    const fadeMs = options.fadeInMs ?? 0
    const loop = options.loop ?? false
    const streamId = `backend-music:${++this.musicStreamSeq}`
    const seq = this.musicStreamSeq

    const startStream = async (startFadeMs: number): Promise<void> => {
      const stream = await streamFactory()

      if (this.musicGeneration !== myGeneration) {
        // Superseded by a newer playMusic/stopCurrentTrack call while this
        // decode — the initial start, or a loop restart — was in flight.
        // Checked here (not just once after the initial call below) so a
        // Stop issued while a *loop restart* is decoding can't resurrect
        // playback either: never register with the engine, just drop it.
        stream.destroy?.()
        return
      }

      this.musicStreams.set(streamId, { metadata, seq, loop })
      this.engine.playMusicFromStream(stream, streamId, startFadeMs > 0 ? 0 : options.volume)
      if (startFadeMs > 0)
        this.engine.rampStreamVolume(streamId, options.volume, startFadeMs)

      const onEnded = () => {
        if (this.musicStreams.get(streamId)?.seq !== seq)
          return
        if (loop) {
          startStream(0).catch((err) => {
            console.error('[GuildAudioManager] Failed to restart looping track:', err)
            this.clearBackendTrack(streamId)
          })
        }
        else {
          this.clearBackendTrack(streamId)
        }
      }
      stream.once('end', onEnded)
      stream.once('error', onEnded)
    }

    await startStream(fadeMs)

    if (this.musicGeneration !== myGeneration) {
      // The initial start itself was superseded (the check inside
      // startStream already aborted it before it registered with the
      // engine, so there is nothing of ours left to tear down) — leave
      // whatever the newer call set up untouched.
      return
    }

    this.backendTrackId = streamId
    this.emit('trackChanged')

    if (outgoingStreamId !== undefined)
      this.fadeOutAndStopBackendTrack(outgoingStreamId, fadeMs)
  }

  /** Stops the current backend-decoded track (started via `playMusic`); a no-op if none is playing. */
  stopCurrentTrack(options: { fadeOutMs?: number } = {}): void {
    this.musicGeneration++
    const streamId = this.backendTrackId
    if (streamId === undefined)
      return
    this.backendTrackId = undefined
    this.fadeOutAndStopBackendTrack(streamId, options.fadeOutMs ?? 0)
    this.emit('trackChanged')
  }

  /** Changes the current backend-decoded track's volume, optionally ramped; a no-op if none is playing. */
  setMusicVolume(volume: number, options: { rampMs?: number } = {}): void {
    const streamId = this.backendTrackId
    if (streamId === undefined)
      return
    const rampMs = options.rampMs ?? 0
    if (rampMs > 0)
      this.engine.rampStreamVolume(streamId, volume, rampMs)
    else
      this.engine.setStreamVolume(streamId, volume)
  }

  /** Clears a backend track's bookkeeping, keeping `backendTrackId` in sync; used by both natural end and loop-restart failure. */
  private clearBackendTrack(streamId: string): void {
    this.musicStreams.delete(streamId)
    if (this.backendTrackId === streamId)
      this.backendTrackId = undefined
    this.emit('trackChanged')
  }

  /**
   * Ramps a backend-decoded stream to silence (or cuts instantly when
   * `fadeMs` is 0) and tears it down at the mixer. Drops its `musicStreams`
   * bookkeeping immediately rather than waiting for the fade (or the
   * stream's own 'end' event, which never fires here — `AudioEngine.stopMusic`
   * strips that listener via `removeAllListeners()` before destroying the
   * stream): this id already lost "latest" status to whatever track replaced
   * it, so `track` reports correctly regardless, and waiting would leak the
   * entry if the engine-side stream had already ended naturally by the time
   * the ramp would otherwise complete (`rampStreamVolume` no-ops with no
   * `onDone` call when there's no active stream left for the id).
   */
  private fadeOutAndStopBackendTrack(streamId: string, fadeMs: number): void {
    this.musicStreams.delete(streamId)
    if (fadeMs > 0)
      this.engine.rampStreamVolume(streamId, 0, fadeMs, () => this.engine.stopMusic(streamId))
    else
      this.engine.stopMusic(streamId)
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
