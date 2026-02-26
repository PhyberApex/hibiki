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
  loop?: boolean
  volume: number
}

const DEFAULT_VOLUMES = { music: 85, effects: 90 }
const CLAMP = (v: number) => Math.min(100, Math.max(0, Math.round(v)))

export class AudioEngine {
  private readonly mixer: AudioMixer
  private readonly mixerOutput = new PassThrough()
  private readonly player: AudioPlayer
  private readonly resource: AudioResource<null>
  private background?: ActiveStream
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

  playMusicFromStream(stream: Readable) {
    this.stopBackground()
    this.background = this.spawnInputFromStream(stream, this.volumes.music, false)
  }

  playEffectFromStream(stream: Readable) {
    const effectStream = this.spawnInputFromStream(stream, this.volumes.effects, false)
    this.effectStreams.add(effectStream)

    // Auto-cleanup when stream ends
    stream.once('end', () => {
      this.effectStreams.delete(effectStream)
    })
    stream.once('error', () => {
      this.effectStreams.delete(effectStream)
    })
  }

  stopMusic() {
    this.stopBackground()
  }

  destroy() {
    this.stopBackground()
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

  private spawnInputFromStream(
    stream: Readable,
    volume: number,
    _loop: boolean,
  ): ActiveStream {
    const input = this.mixer.createAudioInput({
      sampleRate: 48000,
      channels: 2,
      bitDepth: 16,
      volume,
    })

    stream.pipe(input)

    stream.once('error', () => {
      input.destroy()
      if (this.background?.source === stream)
        this.background = undefined
    })
    stream.once('end', () => {
      input.destroy()
      if (this.background?.source === stream)
        this.background = undefined
    })
    return { source: stream, input, volume }
  }

  private stopBackground() {
    if (!this.background)
      return
    this.background.source.removeAllListeners?.()
    this.background.source.destroy?.()
    this.background.input.destroy()
    this.background = undefined
  }
}
