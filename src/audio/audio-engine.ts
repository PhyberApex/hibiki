import type {
  AudioPlayer,
  AudioResource,
} from '@discordjs/voice'
import type { Readable } from 'node:stream'
import { PassThrough } from 'node:stream'
import {
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  StreamType,
} from '@discordjs/voice'
import { AudioMixer } from 'node-audio-mixer'

/** Mixer input: Writable stream with destroy() */
interface MixerInputLike {
  destroy: () => void
}

/** One active stream (music or effect) feeding into the mixer */
interface ActiveStream {
  source: Readable
  input: MixerInputLike
  volume: number
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

  playMusicFromStream(stream: Readable, streamId?: string) {
    this.stopMusicStream(streamId)
    const active = this.spawnInputFromStream(stream, this.volumes.music)
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
    active.source.removeAllListeners?.()
    active.source.destroy?.()
    active.input.destroy()
    this.musicStreams.delete(streamId)
  }
}
