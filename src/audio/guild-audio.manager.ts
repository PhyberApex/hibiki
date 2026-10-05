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

export interface PlayAmbienceOptions {
  /** 0-100, the absolute volume to play this sound at (see ADR-0003 — no master bus layered on top yet). */
  volume: number
  /** Both 0 means a seamless loop; otherwise each play-through is followed by a random delay in this range (seconds) before the next. */
  repeatMin: number
  repeatMax: number
  /** Crossfades: the new sound ramps in from 0 over this duration instead of starting at full volume. */
  fadeInMs?: number
}

/**
 * One Ambience sound's bookkeeping, keyed by soundId in `ambienceEntries` —
 * several can be active at once per guild. Only ever holds a sound that has
 * actually started with the engine; a decode in flight has nothing here
 * yet (see `playAmbience`'s `ambienceGenerations` guard).
 */
interface AmbienceEntry {
  streamId: string
  /** Current target volume; kept in sync by `setAmbienceVolume` even while no stream is actively registered with the engine (the gap between interval-repeat play-throughs), so the next restart picks it up. */
  volume: number
  repeatMin: number
  repeatMax: number
  /** Seamless loop (both repeat bounds 0) vs. restart-after-random-delay. */
  loop: boolean
  /** Pending interval-repeat restart, if currently waiting out the gap between play-throughs. */
  repeatTimer?: ReturnType<typeof setTimeout>
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
  /** Several Ambience sounds can be active at once per guild, keyed by soundId. */
  private readonly ambienceEntries = new Map<string, AmbienceEntry>()
  /**
   * Bumped at the start of every `playAmbience`/`stopAmbience` call for a
   * given soundId and captured by the in-flight decode/restart it started —
   * same race guard as `musicGeneration`, scoped per soundId instead of per
   * guild since Ambience sounds are independent of each other. Kept
   * separate from `ambienceEntries` (rather than a field on the entry)
   * because an in-flight decode has no entry yet, and the generation must
   * still be checkable — and bumpable by a superseding call — before one exists.
   */
  private readonly ambienceGenerations = new Map<string, number>()
  private ambienceStreamSeq = 0
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
    this.stopAllAmbience()
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
    this.stopAllAmbience()
    this.withIntentionalTeardown(() => getVoiceConnection(this.guildId)?.destroy())
    this.connection = undefined
    this.channelName = undefined
  }

  destroy() {
    this.stopAllMusic()
    this.stopAllAmbience()
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

  /**
   * Plays a Sound Library Ambience sound decoded straight into the mixer
   * (see ADR-0003), replacing whatever was already playing under this
   * soundId once the new one has actually started (mirrors `playMusic`'s
   * outgoing-track handling — a failed decode never touches what was
   * already playing). `repeatMin`/`repeatMax` both 0 means a seamless
   * loop; otherwise each play-through is followed by a random delay in
   * that range before the next, matching `SceneView.vue`'s renderer
   * behaviour. With `fadeInMs`, the new sound ramps in from 0 while a
   * replaced sound under the same soundId ramps out over the same
   * duration instead of cutting — crossfade parity with `playMusic`.
   * Rejects (leaving any current entry for this soundId untouched) if
   * `streamFactory` fails on its first call. If superseded by another
   * `playAmbience`/`stopAmbience` call for the same soundId before the
   * decode resolves, this resolves without taking effect.
   */
  async playAmbience(
    streamFactory: () => Readable | Promise<Readable>,
    soundId: string,
    options: PlayAmbienceOptions,
  ): Promise<void> {
    const myGeneration = (this.ambienceGenerations.get(soundId) ?? 0) + 1
    this.ambienceGenerations.set(soundId, myGeneration)
    const outgoingStreamId = this.ambienceEntries.get(soundId)?.streamId
    const streamId = `backend-ambience:${soundId}:${++this.ambienceStreamSeq}`
    // Built once and reused by identity across loop/interval-repeat restarts
    // (not rebuilt from `options` each time), so a `setAmbienceVolume` call
    // made during the gap between play-throughs is still the volume the next
    // restart picks up — only `playAmbience` itself may replace this object.
    const entry: AmbienceEntry = {
      streamId,
      volume: options.volume,
      repeatMin: options.repeatMin,
      repeatMax: options.repeatMax,
      loop: options.repeatMin <= 0 && options.repeatMax <= 0,
    }

    const startStream = async (startFadeMs: number): Promise<void> => {
      const stream = await streamFactory()

      if (this.ambienceGenerations.get(soundId) !== myGeneration) {
        // Superseded by a newer playAmbience/stopAmbience call while this
        // decode — the initial start, or a loop/interval-repeat restart —
        // was in flight: never register with the engine, just drop it.
        stream.destroy?.()
        return
      }

      this.ambienceEntries.set(soundId, entry)
      this.engine.playMusicFromStream(stream, streamId, startFadeMs > 0 ? 0 : entry.volume)
      if (startFadeMs > 0)
        this.engine.rampStreamVolume(streamId, entry.volume, startFadeMs)

      const onEnded = () => {
        if (this.ambienceGenerations.get(soundId) !== myGeneration)
          return
        if (this.ambienceEntries.get(soundId) !== entry)
          return
        if (entry.loop) {
          startStream(0).catch((err) => {
            console.error('[GuildAudioManager] Failed to restart looping ambience:', err)
            this.clearAmbienceEntry(soundId, entry)
          })
        }
        else {
          const minMs = entry.repeatMin * 1000
          const maxMs = entry.repeatMax * 1000
          const delay = minMs + Math.random() * (maxMs - minMs)
          entry.repeatTimer = setTimeout(() => {
            entry.repeatTimer = undefined
            startStream(0).catch((err) => {
              console.error('[GuildAudioManager] Failed to restart interval-repeat ambience:', err)
              this.clearAmbienceEntry(soundId, entry)
            })
          }, delay)
        }
      }
      stream.once('end', onEnded)
      stream.once('error', onEnded)
    }

    await startStream(options.fadeInMs ?? 0)

    if (this.ambienceGenerations.get(soundId) !== myGeneration) {
      // The initial start itself was superseded (the check inside
      // startStream already aborted it before it registered with the
      // engine, so there is nothing of ours left to tear down) — leave
      // whatever the newer call set up untouched.
      return
    }

    if (outgoingStreamId !== undefined)
      this.fadeOutAndStopStream(outgoingStreamId, options.fadeInMs ?? 0)
    this.emit('ambienceChanged')
  }

  /** Stops the Ambience sound for `soundId` (started via `playAmbience`); a no-op if it isn't playing. Clears any pending interval-repeat restart. */
  stopAmbience(soundId: string, options: { fadeOutMs?: number } = {}): void {
    this.ambienceGenerations.set(soundId, (this.ambienceGenerations.get(soundId) ?? 0) + 1)
    const entry = this.ambienceEntries.get(soundId)
    if (!entry)
      return
    this.clearAmbienceRepeatTimer(entry)
    this.ambienceEntries.delete(soundId)
    this.fadeOutAndStopStream(entry.streamId, options.fadeOutMs ?? 0)
    this.emit('ambienceChanged')
  }

  /** Changes an Ambience sound's volume, optionally ramped; a no-op if `soundId` isn't playing. Updates the stored target even between interval-repeat play-throughs, so the next restart picks it up (the shared-sound Scene Crossfade rule). */
  setAmbienceVolume(soundId: string, volume: number, options: { rampMs?: number } = {}): void {
    const entry = this.ambienceEntries.get(soundId)
    if (!entry)
      return
    entry.volume = volume
    const rampMs = options.rampMs ?? 0
    if (rampMs > 0)
      this.engine.rampStreamVolume(entry.streamId, volume, rampMs)
    else
      this.engine.setStreamVolume(entry.streamId, volume)
  }

  /** Ends every Ambience sound for this guild, clearing their repeat timers. Bulk teardown, like `stopAllMusic`, so it does not emit `ambienceChanged` per sound. */
  stopAllAmbience(): void {
    for (const entry of this.ambienceEntries.values()) {
      this.clearAmbienceRepeatTimer(entry)
      this.engine.stopMusic(entry.streamId)
    }
    this.ambienceEntries.clear()
  }

  /** soundIds of every Ambience sound currently active (playing or waiting out its repeat gap) for this guild. */
  get activeAmbience(): string[] {
    return [...this.ambienceEntries.keys()]
  }

  private clearAmbienceRepeatTimer(entry: AmbienceEntry): void {
    if (entry.repeatTimer != null) {
      clearTimeout(entry.repeatTimer)
      entry.repeatTimer = undefined
    }
  }

  /** Clears an Ambience sound's bookkeeping if `entry` is still the active one for `soundId` (a natural end-of-chain failure or a superseded call is a no-op here). */
  private clearAmbienceEntry(soundId: string, entry: AmbienceEntry): void {
    if (this.ambienceEntries.get(soundId) !== entry)
      return
    this.ambienceEntries.delete(soundId)
    this.emit('ambienceChanged')
  }

  /** Ramps a stream to silence (or cuts instantly when `fadeMs` is 0) and tears it down at the mixer. */
  private fadeOutAndStopStream(streamId: string, fadeMs: number): void {
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
