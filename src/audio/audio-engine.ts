import type {
  AudioPlayer,
  AudioResource,
} from '@discordjs/voice'
import type { AudioInput } from 'node-audio-mixer'
import type { Readable } from 'node:stream'
import type { MixerFeed } from './mixer-feed'
import { PassThrough } from 'node:stream'
import {
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  StreamType,
} from '@discordjs/voice'
import { AudioMixer } from 'node-audio-mixer'
import { createLogger } from '../logger'
import { feedMixerInput, MIXER_PACKET_BYTES } from './mixer-feed'
import { rampVolume } from './volume-ramp'

const log = createLogger('audio-engine')

/** One active stream (music or effect) feeding into the mixer */
interface ActiveStream {
  source: Readable
  input: AudioInput
  feed: MixerFeed
  volume: number
  /** Cancels an in-progress volume ramp started by `rampStreamVolume`, if any. */
  cancelRamp?: () => void
}

const DEFAULT_VOLUMES = { music: 85, effects: 90 }
const CLAMP = (v: number) => Math.min(100, Math.max(0, Math.round(v)))

export class AudioEngine {
  private readonly mixer: AudioMixer
  private readonly mixerOutput = new PassThrough()
  private readonly player: AudioPlayer
  private readonly resource: AudioResource<null>
  /** Music streams by id; a start without an id keys to the `undefined` slot. */
  private readonly musicStreams = new Map<string | undefined, ActiveStream>()
  private readonly effectStreams = new Set<ActiveStream>()

  constructor() {
    // `highWaterMark` fixes each mixer tick to one packet from every input
    // that holds at least one. Without it a tick takes the *smallest*
    // non-empty input's whole queue and leaves empty inputs out of the sum,
    // and since each feed tops its input up on its own 20 ms poll, two
    // concurrent sounds (music plus ambience) come out as alternating solo
    // bursts instead of a mix.
    this.mixer = new AudioMixer({
      sampleRate: 48000,
      channels: 2,
      bitDepth: 16,
      generateSilence: true,
      autoClose: false,
      highWaterMark: MIXER_PACKET_BYTES,
    })

    // Pipe mixer directly to output (no Opus encoding - Discord.js handles it)
    this.mixer.pipe(this.mixerOutput)

    // Create audio player with raw PCM stream
    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    })
    this.resource = createAudioResource<null>(this.mixerOutput, {
      inputType: StreamType.Raw, // Raw PCM - let Discord.js handle Opus encoding
    })
    this.player.play(this.resource)

    this.player.on('error', (error) => {
      log.error('AudioPlayer error:', error.message)
    })
    this.player.on('stateChange', (oldState, newState) => {
      log.info(`AudioPlayer state: ${oldState.status} -> ${newState.status}`)
    })
  }

  get audioPlayer() {
    return this.player
  }

  /**
   * Starts `stream` as the music stream under `streamId` (replacing any
   * stream already under that id). `onEnded` fires once the stream has
   * played out through the mixer, or errored; never after a stop or a
   * replacement.
   */
  playMusicFromStream(stream: Readable, streamId?: string, initialVolume: number = DEFAULT_VOLUMES.music, onEnded?: () => void) {
    this.stopMusicStream(streamId)
    log.debug(`Mixer input opened for ${streamId ?? '(default)'} at volume ${CLAMP(initialVolume)}`)
    const active = this.spawnInputFromStream(stream, CLAMP(initialVolume), (ended) => {
      if (this.musicStreams.get(streamId) !== ended)
        return
      log.debug(`Mixer input for ${streamId ?? '(default)'} drained`)
      ended.input.destroy()
      this.musicStreams.delete(streamId)
      onEnded?.()
    })
    this.musicStreams.set(streamId, active)
  }

  playEffectFromStream(stream: Readable) {
    const effectStream = this.spawnInputFromStream(stream, DEFAULT_VOLUMES.effects, (ended) => {
      ended.input.destroy()
      this.effectStreams.delete(ended)
    })
    this.effectStreams.add(effectStream)
  }

  /** Ends the music stream for `streamId` (or the default stream when omitted). Other ids are untouched. */
  stopMusic(streamId?: string) {
    this.stopMusicStream(streamId)
  }

  /**
   * Sets a music stream's volume immediately, cancelling any in-progress
   * ramp on it. `node-audio-mixer` inputs apply `params.volume` live (see
   * ADR-0003), so this needs no gain `Transform`. No-op if the stream has
   * already ended.
   */
  setStreamVolume(streamId: string | undefined, volume: number): void {
    const active = this.musicStreams.get(streamId)
    if (!active)
      return
    active.cancelRamp?.()
    active.cancelRamp = undefined
    active.volume = CLAMP(volume)
    active.input.params = { volume: active.volume }
  }

  /**
   * Ramps a music stream's volume from its current value to `to` over
   * `durationMs`, replacing any ramp already in progress on it. No-op if the
   * stream has already ended.
   */
  rampStreamVolume(streamId: string | undefined, to: number, durationMs: number, onDone?: () => void): void {
    const active = this.musicStreams.get(streamId)
    if (!active)
      return
    active.cancelRamp?.()
    if (durationMs <= 0) {
      this.setStreamVolume(streamId, to)
      onDone?.()
      return
    }
    const handle = rampVolume({
      from: active.volume,
      to,
      durationMs,
      onVolume: (v) => {
        active.volume = CLAMP(v)
        active.input.params = { volume: active.volume }
      },
      onDone: () => {
        active.cancelRamp = undefined
        onDone?.()
      },
    })
    active.cancelRamp = handle.cancel
  }

  /** Ends every music stream for this guild, regardless of id. */
  stopAllMusic() {
    for (const id of [...this.musicStreams.keys()])
      this.stopMusicStream(id)
  }

  destroy() {
    this.stopAllMusic()
    // Clean up all effect streams
    for (const effect of this.effectStreams)
      this.teardown(effect)
    this.effectStreams.clear()
    this.mixer.destroy()
    this.player.stop(true)
    this.mixerOutput.destroy()
  }

  private spawnInputFromStream(stream: Readable, volume: number, onEnded: (active: ActiveStream) => void): ActiveStream {
    const input = this.mixer.createAudioInput({
      sampleRate: 48000,
      channels: 2,
      bitDepth: 16,
      volume,
    })

    const active: ActiveStream = { source: stream, input, volume, feed: { stop: () => {} } }
    active.feed = feedMixerInput(stream, input, { onEnded: () => onEnded(active) })
    return active
  }

  private stopMusicStream(streamId?: string) {
    const active = this.musicStreams.get(streamId)
    if (!active)
      return
    log.debug(`Mixer input for ${streamId ?? '(default)'} cut`)
    active.cancelRamp?.()
    this.teardown(active)
    this.musicStreams.delete(streamId)
  }

  /**
   * Cuts a stream immediately. Without `forceClose`, a destroyed input stays
   * in the mixer until whatever it still holds has played out.
   */
  private teardown(active: ActiveStream) {
    active.feed.stop()
    active.source.removeAllListeners?.()
    active.source.destroy?.()
    active.input.params = { forceClose: true }
    active.input.destroy()
  }
}
