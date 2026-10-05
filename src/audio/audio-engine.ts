import type {
  AudioPlayer,
  AudioResource,
} from '@discordjs/voice'
import type { AudioInput } from 'node-audio-mixer'
import type { Readable } from 'node:stream'
import { PassThrough } from 'node:stream'
import {
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  StreamType,
} from '@discordjs/voice'
import { AudioMixer } from 'node-audio-mixer'
import { rampVolume } from './volume-ramp'

/** One active stream (music or effect) feeding into the mixer */
interface ActiveStream {
  source: Readable
  input: AudioInput
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
  private volumes = { ...DEFAULT_VOLUMES }

  constructor(initialVolumes = DEFAULT_VOLUMES) {
    this.volumes = { music: CLAMP(initialVolumes.music), effects: CLAMP(initialVolumes.effects) }

    // Create mixer for combining audio streams
    this.mixer = new AudioMixer({
      sampleRate: 48000,
      channels: 2,
      bitDepth: 16,
      generateSilence: true,
      autoClose: false,
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
      console.error('[AudioEngine] AudioPlayer error:', error.message)
    })
  }

  get audioPlayer() {
    return this.player
  }

  getVolumes(): { music: number, effects: number } {
    return { ...this.volumes }
  }

  setVolumes(updates: { music?: number, effects?: number }): void {
    if (typeof updates.music === 'number')
      this.volumes.music = CLAMP(updates.music)
    if (typeof updates.effects === 'number')
      this.volumes.effects = CLAMP(updates.effects)
  }

  playMusicFromStream(stream: Readable, streamId?: string, initialVolume: number = this.volumes.music) {
    this.stopMusicStream(streamId)
    const active = this.spawnInputFromStream(stream, CLAMP(initialVolume))
    this.musicStreams.set(streamId, active)

    const onEnded = () => {
      if (this.musicStreams.get(streamId) === active) {
        active.input.destroy()
        this.musicStreams.delete(streamId)
      }
    }
    stream.once('end', onEnded)
    stream.once('error', onEnded)
  }

  playEffectFromStream(stream: Readable) {
    const effectStream = this.spawnInputFromStream(stream, this.volumes.effects)
    this.effectStreams.add(effectStream)

    // Auto-cleanup when stream ends
    stream.once('end', () => {
      this.effectStreams.delete(effectStream)
    })
    stream.once('error', () => {
      this.effectStreams.delete(effectStream)
    })
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
    for (const effect of this.effectStreams) {
      effect.source.removeAllListeners?.()
      effect.source.destroy?.()
      effect.input.destroy()
    }
    this.effectStreams.clear()
    this.mixer.destroy()
    this.player.stop(true)
    this.mixerOutput.destroy()
  }

  private spawnInputFromStream(stream: Readable, volume: number): ActiveStream {
    const input = this.mixer.createAudioInput({
      sampleRate: 48000,
      channels: 2,
      bitDepth: 16,
      volume,
    })

    stream.pipe(input)

    return { source: stream, input, volume }
  }

  private stopMusicStream(streamId?: string) {
    const active = this.musicStreams.get(streamId)
    if (!active)
      return
    active.cancelRamp?.()
    active.source.removeAllListeners?.()
    active.source.destroy?.()
    active.input.destroy()
    this.musicStreams.delete(streamId)
  }
}
