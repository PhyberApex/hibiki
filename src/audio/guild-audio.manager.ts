import type { DiscordGatewayAdapterCreator, VoiceConnection } from '@discordjs/voice'
import type { VoiceBasedChannel } from 'discord.js'
import type { Readable } from 'node:stream'
import type { SoundCategory } from '../sound/sound.types'
import type { LocalSink } from './local-sink-pump'
import { EventEmitter } from 'node:events'
import {
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  NetworkingStatusCode,
  VoiceConnectionStatus,
} from '@discordjs/voice'
import { createLogger } from '../logger'
import { AudioEngine } from './audio-engine'
import { resolveVoiceOptions } from './voice-options'

const log = createLogger('voice')

/** How long after Ready to log the encryption state again: the DAVE (end-to-end encryption) handshake completes asynchronously after the connection is ready. */
const ENCRYPTION_RECHECK_MS = 3_000

/**
 * One-line summary of what protects the audio on this connection. Discord
 * shows the bot as speaking for every packet it receives, decryptable or
 * not, so when a GM reports "green ring but no sound" this line is the
 * first thing to read: a DAVE session that is "NOT ready" means every
 * packet is sent without end-to-end encryption and gets discarded by
 * clients in an encrypted call.
 */
function describeEncryption(connection: VoiceConnection): string {
  const state = connection.state
  if (!state)
    return 'connection state unknown'
  if (state.status !== VoiceConnectionStatus.Ready)
    return `connection ${state.status}`
  const networking = state.networking?.state
  if (!networking || networking.code !== NetworkingStatusCode.Ready)
    return `networking not ready (code ${networking?.code ?? 'unknown'})`
  const transport = networking.connectionData?.encryptionMode ?? 'unknown'
  const dave = networking.dave
  if (!dave)
    return `transport ${transport}, no DAVE session (end-to-end encryption off or unsupported)`
  return `transport ${transport}, DAVE protocol v${dave.protocolVersion}, session ${dave.session?.ready ? 'ready' : 'NOT ready'}, privacy code ${dave.voicePrivacyCode ?? 'none'}`
}

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
  /** 0-100, the volume this track is heading to: `playMusic`'s volume, then each `setMusicVolume` target. A loop restart starts at this, not the original (#642). */
  volume?: number
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

export interface PlayEffectOptions {
  /** 0-100, the absolute volume to play this instance at (see ADR-0003 — no master bus layered on top yet). */
  volume: number
}

/** What `playEffect` resolves with, and what `activeEffects` reports per Effect Instance (#509). */
export interface EffectInstanceInfo {
  instanceId: string
  soundId: string
  startedAt: string
  durationMs: number
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
  private readonly engine: AudioEngine
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
   * see `agent-docs/adr/0003-backend-sound-library-playback.md`.
   */
  private backendTrackId?: string
  /**
   * Bumped at the start of every `playMusic`/`stopCurrentTrack`/`stopAllMusic` call and
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
   * given soundId (and for every soundId by `stopAllAmbience`) and captured by the in-flight decode/restart it started —
   * same race guard as `musicGeneration`, scoped per soundId instead of per
   * guild since Ambience sounds are independent of each other. Kept
   * separate from `ambienceEntries` (rather than a field on the entry)
   * because an in-flight decode has no entry yet, and the generation must
   * still be checkable — and bumpable by a superseding call — before one exists.
   */
  private readonly ambienceGenerations = new Map<string, number>()
  private ambienceStreamSeq = 0
  /**
   * streamIds of backend-decoded Effect instances currently playing, in the
   * order they started — a `Set` preserves insertion order, so the first
   * entry is always the oldest, which `enforceEffectInstanceCap` needs for
   * FIFO eviction. Unlike `musicStreams`/`ambienceEntries`, Effects never
   * replace each other (every trigger is its own instance, layered freely —
   * overlap parity with the renderer's own Effect cap, #408), so this only
   * ever grows (on trigger) or shrinks (on end/cap eviction/bulk stop),
   * never replaces an entry in place.
   */
  private readonly effectStreamIds = new Set<string>()
  private effectStreamSeq = 0
  /**
   * Bookkeeping for `activeEffects`/`getState()` reporting (#509), keyed the
   * same way as `effectStreamIds` but only holding an entry once the
   * instance has actually started making sound — not while its slot is
   * merely reserved pending a decode still in flight (`effectStreamIds`
   * alone covers that window, for cap ordering). `effectStreamIds` stays
   * the source of truth for "is this id still live at all" (cap
   * enforcement, `stopEffect`'s no-op check); this is strictly a subset of
   * it.
   */
  private readonly effectInstances = new Map<string, Omit<EffectInstanceInfo, 'instanceId'>>()
  /** Matches the renderer's own Effect cap (`EFFECT_INSTANCE_CAP` in SceneView.vue, #408). */
  private static readonly EFFECT_INSTANCE_CAP = 8
  /**
   * Set while this manager is itself tearing down a connection, so the
   * resulting Destroyed stateChange doesn't re-trigger teardown handling.
   */
  private intentionalTeardown = false
  /** Set once the engine is shut down, so no path destroys it twice. */
  private engineDestroyed = false

  /**
   * `localSink` makes this the Local Target's engine (ADR-0004): no voice
   * connection, the mix goes to the sink and `connected` is always true.
   */
  constructor(private readonly guildId: string, private readonly localSink?: LocalSink) {
    super()
    this.engine = new AudioEngine({
      localSink,
      onLocalSinkFailure: () => this.stopEverything(),
    })
  }

  /** Stops all Music, Ambience and Effects on this Target. */
  stopEverything(): void {
    this.stopAllMusic()
    this.stopAllAmbience()
    this.stopAllEffects()
  }

  /** The Local sink died (device lost, context closed, ...): stop all playback instead of mixing into silence. */
  handleSinkDead(reason: string): void {
    log.error(`Local sink is dead (${reason}); stopping all local playback`)
    this.stopEverything()
    this.engine.stopLocalSink()
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

    const voiceOptions = resolveVoiceOptions()
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: false,
      debug: true,
      daveEncryption: voiceOptions.daveEncryption,
    })
    this.connection = connection
    this.channelName = channel.name

    log.info(`Connecting to "${channel.name}" (${channel.id}) in guild ${this.guildId}, DAVE end-to-end encryption ${voiceOptions.daveEncryption ? 'on' : 'OFF (HIBIKI_DAVE_ENCRYPTION=off)'}`)
    connection.on('error', (error) => {
      log.error(`VoiceConnection error (guild ${this.guildId}):`, error.message)
    })
    connection.on('debug', (message) => {
      log.debug(`VoiceConnection (guild ${this.guildId}): ${message}`)
    })
    connection.on('stateChange', (oldState, newState) => {
      log.info(`VoiceConnection state: ${oldState.status} -> ${newState.status} (guild ${this.guildId})`)
      if (newState.status === VoiceConnectionStatus.Disconnected)
        this.handleDisconnect(connection)
      if (newState.status === VoiceConnectionStatus.Destroyed)
        this.handleTeardown(connection)
    })
    connection.subscribe(this.engine.audioPlayer)
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000)
    }
    catch (err) {
      log.error(`Voice connection to "${channel.name}" did not become ready within 20 s (guild ${this.guildId})`, err)
      throw err
    }
    log.info(`Voice connection ready in "${channel.name}" (guild ${this.guildId}): ${describeEncryption(connection)}`)
    this.scheduleEncryptionRecheck(connection)
    return connection
  }

  private encryptionRecheck?: ReturnType<typeof setTimeout>

  private scheduleEncryptionRecheck(connection: VoiceConnection): void {
    this.clearEncryptionRecheck()
    this.encryptionRecheck = setTimeout(() => {
      this.encryptionRecheck = undefined
      if (this.connection === connection)
        log.info(`Encryption ${ENCRYPTION_RECHECK_MS} ms after ready (guild ${this.guildId}): ${describeEncryption(connection)}`)
    }, ENCRYPTION_RECHECK_MS)
    this.encryptionRecheck.unref?.()
  }

  private clearEncryptionRecheck(): void {
    if (this.encryptionRecheck !== undefined) {
      clearTimeout(this.encryptionRecheck)
      this.encryptionRecheck = undefined
    }
  }

  /** Current encryption summary for playback logs, or a placeholder when not connected. */
  private get encryptionSummary(): string {
    return this.connection
      ? describeEncryption(this.connection)
      : 'no connection'
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
      log.warn(`Voice connection did not recover within ${RECONNECT_GRACE_PERIOD_MS} ms; tearing it down (guild ${this.guildId})`)
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
    log.warn(`Voice connection was destroyed externally; stopping all playback (guild ${this.guildId})`)
    this.stopAllMusic()
    this.stopAllAmbience()
    this.stopAllEffects()
    this.connection = undefined
    this.channelName = undefined
    this.destroyEngine('teardown')
    this.emit('disconnected')
  }

  /**
   * Runs `action` with `intentionalTeardown` set, so a resulting Destroyed
   * stateChange is suppressed instead of being treated as an external kill.
   */
  private withIntentionalTeardown(action: () => void): void {
    this.intentionalTeardown = true
    try {
      action()
    }
    finally {
      this.intentionalTeardown = false
    }
  }

  /**
   * Destroys `connection` under the intentional-teardown guard. Skipped when
   * it is already Destroyed, since `VoiceConnection.destroy()` throws then.
   */
  private destroyOwnConnection(connection: VoiceConnection | undefined): void {
    if (!connection || connection.state?.status === VoiceConnectionStatus.Destroyed)
      return
    this.withIntentionalTeardown(() => connection.destroy())
  }

  private destroyConnection() {
    this.destroyOwnConnection(this.connection)
  }

  /**
   * Shuts the engine down once this manager gives up its connection: the
   * mixer's read loop otherwise reschedules itself every 1 ms forever (#643).
   */
  private destroyEngine(reason: 'disconnect' | 'teardown' | 'shutdown'): void {
    if (this.engineDestroyed)
      return
    this.engineDestroyed = true
    this.engine.destroy()
    log.info(`Audio engine destroyed (guild ${this.guildId}, reason ${reason})`)
  }

  disconnect() {
    log.info(`Leaving voice channel (guild ${this.guildId})`)
    this.clearEncryptionRecheck()
    this.stopAllMusic()
    this.stopAllAmbience()
    this.stopAllEffects()
    try {
      this.destroyOwnConnection(getVoiceConnection(this.guildId))
    }
    catch (err) {
      log.warn(`Destroying the voice connection failed while leaving (guild ${this.guildId}):`, err)
    }
    this.connection = undefined
    this.channelName = undefined
    this.destroyEngine('disconnect')
  }

  destroy() {
    this.clearEncryptionRecheck()
    this.stopAllMusic()
    this.stopAllAmbience()
    this.stopAllEffects()
    try {
      this.destroyOwnConnection(this.connection)
    }
    finally {
      this.connection = undefined
      this.destroyEngine('shutdown')
    }
  }

  /**
   * Starts a music stream under `streamId` (or the default slot when
   * omitted). An existing stream under the same id is replaced, same as a
   * plain restart; other ids are left playing.
   */
  playMusicFromStream(stream: Readable, metadata?: TrackMetadata, streamId?: string) {
    const seq = ++this.musicStreamSeq
    this.musicStreams.set(streamId, { metadata, seq })
    this.engine.playMusicFromStream(stream, streamId, undefined, () => {
      if (this.musicStreams.get(streamId)?.seq === seq)
        this.musicStreams.delete(streamId)
    })
  }

  /** Ends the music stream for `streamId` (or the default slot when omitted). Other ids keep playing. */
  stopMusic(streamId?: string) {
    this.musicStreams.delete(streamId)
    if (this.backendTrackId === streamId)
      this.backendTrackId = undefined
    this.engine.stopMusic(streamId)
  }

  /** Ends every music stream for this guild, regardless of id. Also supersedes any `playMusic` decode or loop restart still in flight (#640). */
  stopAllMusic() {
    this.musicGeneration++
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
   * another `playMusic`/`stopCurrentTrack`/`stopAllMusic` call before the decode resolves,
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

    const startStream = async (startFadeMs: number, isRestart: boolean): Promise<void> => {
      const stream = await streamFactory()

      // Superseded by a newer playMusic/stopCurrentTrack/stopAllMusic call
      // while this decode — the initial start, or a loop restart — was in
      // flight. Checked here (not just once after the initial call below) so
      // a Stop, Leave or teardown issued while a *loop restart* is decoding
      // can't resurrect playback either: never register with the engine,
      // just drop it. A restart additionally needs its own stream to still
      // be registered, since it was dropped from bookkeeping if not (#640).
      const superseded = this.musicGeneration !== myGeneration
      if (superseded || (isRestart && this.musicStreams.get(streamId)?.seq !== seq)) {
        log.info(`Music "${metadata.name}" ${isRestart ? 'loop restart' : 'start'} of ${streamId} dropped: ${superseded ? 'superseded or stopped' : 'stream no longer registered'} while decoding (guild ${this.guildId})`)
        stream.destroy?.()
        return
      }

      const onEnded = () => {
        if (this.musicStreams.get(streamId)?.seq !== seq)
          return
        if (loop) {
          log.debug(`Music ${streamId} reached its end; looping`)
          startStream(0, true).catch((err) => {
            log.error('Failed to restart looping track:', err)
            this.clearBackendTrack(streamId)
          })
        }
        else {
          log.info(`Music ${streamId} played out`)
          this.clearBackendTrack(streamId)
        }
      }

      const volume = isRestart
        ? this.musicStreams.get(streamId)?.volume ?? options.volume
        : options.volume
      log.info(`Music "${metadata.name}" starting as ${streamId}${isRestart ? ' (loop restart)' : ''}: volume ${volume}, loop ${loop}, fadeIn ${startFadeMs} ms; ${this.encryptionSummary}`)
      this.musicStreams.set(streamId, { metadata, seq, loop, volume })
      this.engine.playMusicFromStream(stream, streamId, startFadeMs > 0
        ? 0
        : volume, onEnded)
      if (startFadeMs > 0)
        this.engine.rampStreamVolume(streamId, volume, startFadeMs)
    }

    await startStream(fadeMs, false)

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
    if (streamId === undefined) {
      log.debug(`stopCurrentTrack: nothing playing (guild ${this.guildId})`)
      return
    }
    log.info(`Stopping music ${streamId}, fadeOut ${options.fadeOutMs ?? 0} ms`)
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
    const entry = this.musicStreams.get(streamId)
    if (entry)
      entry.volume = volume
    log.debug(`Music ${streamId} volume -> ${volume}, ramp ${rampMs} ms (guild ${this.guildId})`)
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
   * `playAmbience`/`stopAmbience` call for the same soundId (or a
   * `stopAllAmbience`) before the
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

    const startStream = async (startFadeMs: number, isRestart: boolean): Promise<void> => {
      const stream = await streamFactory()

      // Superseded by a newer playAmbience/stopAmbience/stopAllAmbience call
      // while this decode — the initial start, or a loop/interval-repeat
      // restart — was in flight: never register with the engine, just drop
      // it. A restart additionally needs its entry to still be the active
      // one, since it was dropped from bookkeeping if not (#640).
      const superseded = this.ambienceGenerations.get(soundId) !== myGeneration
      if (superseded || (isRestart && this.ambienceEntries.get(soundId) !== entry)) {
        log.info(`Ambience ${soundId} ${isRestart ? 'restart' : 'start'} of ${streamId} dropped: ${superseded ? 'superseded or stopped' : 'entry no longer active'} while decoding (guild ${this.guildId})`)
        stream.destroy?.()
        return
      }

      const onEnded = () => {
        if (this.ambienceGenerations.get(soundId) !== myGeneration)
          return
        if (this.ambienceEntries.get(soundId) !== entry)
          return
        if (entry.loop) {
          startStream(0, true).catch((err) => {
            log.error('Failed to restart looping ambience:', err)
            this.clearAmbienceEntry(soundId, entry)
          })
        }
        else {
          const minMs = entry.repeatMin * 1000
          const maxMs = entry.repeatMax * 1000
          const delay = minMs + Math.random() * (maxMs - minMs)
          log.debug(`Ambience ${soundId} played out; next repeat in ${Math.round(delay)} ms`)
          entry.repeatTimer = setTimeout(() => {
            entry.repeatTimer = undefined
            startStream(0, true).catch((err) => {
              log.error('Failed to restart interval-repeat ambience:', err)
              this.clearAmbienceEntry(soundId, entry)
            })
          }, delay)
        }
      }

      log.info(`Ambience ${soundId} starting as ${streamId}: volume ${entry.volume}, ${entry.loop
        ? 'seamless loop'
        : `repeat every ${entry.repeatMin}-${entry.repeatMax} s`}, fadeIn ${startFadeMs} ms; ${this.encryptionSummary}`)
      this.ambienceEntries.set(soundId, entry)
      this.engine.playMusicFromStream(stream, streamId, startFadeMs > 0
        ? 0
        : entry.volume, onEnded)
      if (startFadeMs > 0)
        this.engine.rampStreamVolume(streamId, entry.volume, startFadeMs)
    }

    await startStream(options.fadeInMs ?? 0, false)

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
    if (!entry) {
      log.debug(`stopAmbience ${soundId}: not playing (guild ${this.guildId})`)
      return
    }
    log.info(`Stopping ambience ${soundId} (${entry.streamId}), fadeOut ${options.fadeOutMs ?? 0} ms`)
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

  /**
   * Ends every Ambience sound for this guild, clearing their repeat timers.
   * Bulk teardown, like `stopAllMusic`, so it does not emit `ambienceChanged`
   * per sound. Bumps the generation of every soundId ever seen, not just the
   * active entries, so an initial decode still in flight (no entry yet) is
   * superseded too, along with any restart mid-decode (#640).
   */
  stopAllAmbience(): void {
    for (const [soundId, generation] of this.ambienceGenerations)
      this.ambienceGenerations.set(soundId, generation + 1)
    for (const entry of this.ambienceEntries.values()) {
      this.clearAmbienceRepeatTimer(entry)
      this.engine.stopMusic(entry.streamId)
    }
    this.ambienceEntries.clear()
  }

  /** soundIds of every Ambience sound currently active (playing or waiting out its repeat gap) for this guild. */
  get activeAmbience(): string[] {
    return [
      ...this.ambienceEntries.keys(),
    ]
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

  playEffectFromStream(stream: Readable, streamId?: string, initialVolume?: number) {
    this.engine.playEffectFromStream(stream, streamId, initialVolume)
  }

  /** Live volume for a keyed renderer effect stream (a Routed Tab); a no-op once it has drained. */
  setEffectStreamVolume(streamId: string, volume: number) {
    this.engine.setEffectStreamVolume(streamId, volume)
  }

  /**
   * Plays a Sound Library Effect decoded straight into the mixer (see
   * ADR-0003) as a brand new instance, reusing the engine's generic named-
   * stream mixing (the same primitive `playMusic`/`playAmbience` use, under
   * their own id namespaces) rather than `playEffectFromStream`'s anonymous
   * `Set` — a unique id per trigger is what lets a ninth trigger stop just
   * the oldest instance instead of all of them. Unlike `playMusic`/
   * `playAmbience`, a new call never replaces an existing one: every
   * trigger is independent and layers freely, up to `EFFECT_INSTANCE_CAP`
   * simultaneous instances per guild, at which point starting one more
   * stops the oldest (overlap parity with the renderer's own Effect cap,
   * #408). Rejects, leaving every other instance untouched, if
   * `streamFactory` fails. Resolves with the new instance's id and
   * duration (#509) — `streamFactory` reports the duration alongside the
   * stream since the Effect PCM cache always decodes the whole file first
   * (see `effect-pcm-cache.ts`). If this slot is evicted or bulk-cleared
   * while its decode is in flight it still resolves with a well-formed
   * id/duration though it never started: `activeEffects` is the source of
   * truth for liveness, and `stopEffect` on such an id is a safe no-op.
   */
  async playEffect(
    streamFactory: () => { stream: Readable, durationMs: number } | Promise<{ stream: Readable, durationMs: number }>,
    soundId: string,
    options: PlayEffectOptions,
  ): Promise<EffectInstanceInfo> {
    // Reserve the slot (and evict the oldest, if at cap) before decoding —
    // not after — so eviction order matches trigger order rather than
    // decode-completion order. Otherwise a slow cache-miss decode started
    // just before a fast cache-hit one could let the *newer* trigger
    // register first and evict the true oldest instance twice over, while
    // the chronologically later trigger survives.
    const streamId = `backend-effect:${++this.effectStreamSeq}`
    this.enforceEffectInstanceCap()
    this.effectStreamIds.add(streamId)

    let stream: Readable
    let durationMs: number
    try {
      ({ stream, durationMs } = await streamFactory())
    }
    catch (err) {
      this.effectStreamIds.delete(streamId)
      throw err
    }

    if (!this.effectStreamIds.has(streamId)) {
      // This slot was evicted by a later trigger's cap enforcement, or
      // cleared in bulk by stopAllEffects (Scene stop / leave / disconnect),
      // while this decode was still in flight — never register with the
      // engine. Without this check, a slow decode would still start
      // playing after having already been "stopped", since nothing else
      // here ever touches the engine for a slot that was reserved but
      // never decoded.
      stream.destroy?.()
      return {
        instanceId: streamId,
        soundId,
        startedAt: new Date().toISOString(),
        durationMs,
      }
    }

    const startedAt = new Date().toISOString()
    log.info(`Effect "${soundId}" starting as ${streamId}: volume ${options.volume}, duration ${durationMs} ms (${this.effectStreamIds.size} active); ${this.encryptionSummary}`)
    this.effectInstances.set(streamId, { soundId, startedAt, durationMs })
    this.engine.playMusicFromStream(stream, streamId, options.volume, () => {
      log.debug(`Effect ${streamId} played out`)
      this.effectStreamIds.delete(streamId)
      this.effectInstances.delete(streamId)
      this.emit('effectsChanged')
    })
    this.emit('effectsChanged')
    return {
      instanceId: streamId,
      soundId,
      startedAt,
      durationMs,
    }
  }

  /** Ends one backend-decoded Effect Instance by id, leaving every other instance (of this or any other sound) untouched. A missing/already-ended id is a no-op, logged at debug. */
  stopEffect(instanceId: string): void {
    if (!this.effectStreamIds.has(instanceId)) {
      log.debug(`stopEffect ${instanceId}: not active (guild ${this.guildId})`)
      return
    }
    log.info(`Stopping effect instance ${instanceId} (guild ${this.guildId})`)
    this.effectStreamIds.delete(instanceId)
    this.effectInstances.delete(instanceId)
    this.engine.stopMusic(instanceId)
    this.emit('effectsChanged')
  }

  /** Ends every backend-decoded Effect instance for this guild (Scene stop, leave, disconnect). */
  stopAllEffects(): void {
    const hadActive = this.effectInstances.size > 0
    for (const streamId of this.effectStreamIds)
      this.engine.stopMusic(streamId)
    this.effectStreamIds.clear()
    this.effectInstances.clear()
    if (hadActive)
      this.emit('effectsChanged')
  }

  /** Active backend-decoded Effect Instances for this guild (#509), for `getState()` reporting. */
  get activeEffects(): EffectInstanceInfo[] {
    return [
      ...this.effectInstances.entries(),
    ].map(([instanceId, entry]) => ({ instanceId, ...entry }))
  }

  /** FIFO-evicts the oldest backend-decoded Effect instance(s) until there's room for one more, under `EFFECT_INSTANCE_CAP`. */
  private enforceEffectInstanceCap(): void {
    let evictedActive = false
    while (this.effectStreamIds.size >= GuildAudioManager.EFFECT_INSTANCE_CAP) {
      const oldestStreamId: string | undefined = this.effectStreamIds.values().next().value
      if (oldestStreamId === undefined)
        break
      log.info(`Effect cap of ${GuildAudioManager.EFFECT_INSTANCE_CAP} reached; stopping oldest ${oldestStreamId}`)
      this.effectStreamIds.delete(oldestStreamId)
      if (this.effectInstances.delete(oldestStreamId))
        evictedActive = true
      this.engine.stopMusic(oldestStreamId)
    }
    if (evictedActive)
      this.emit('effectsChanged')
  }

  get isIdle() {
    return this.engine.isIdle
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
    return Boolean(this.localSink) || Boolean(this.connection)
  }
}
