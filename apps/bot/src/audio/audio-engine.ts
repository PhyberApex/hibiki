import type {
  AudioPlayer,
  AudioResource,
} from '@discordjs/voice'
import { PassThrough } from 'node:stream'
import {
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  StreamType,
} from '@discordjs/voice'
import { AudioMixer } from 'node-audio-mixer'
import prism from 'prism-media'

/** Mixer input: Writable stream with destroy() */
interface MixerInputLike {
  destroy: () => void
}

/** One active stream (music or effect) feeding into the mixer */
interface ActiveStream {
  ffmpeg: prism.FFmpeg
  input: MixerInputLike
  loop?: boolean
  filePath: string
  volume: number
}

const DEFAULT_VOLUMES = { music: 85, effects: 90 }
const CLAMP = (v: number) => Math.min(100, Math.max(0, Math.round(v)))

export class AudioEngine {
  private readonly mixer: AudioMixer
  private readonly output = new PassThrough()
  private readonly player: AudioPlayer
  private readonly resource: AudioResource<null>
  private background?: ActiveStream
  private volumes = { ...DEFAULT_VOLUMES }

  constructor(initialVolumes = DEFAULT_VOLUMES) {
    this.volumes = { music: CLAMP(initialVolumes.music), effects: CLAMP(initialVolumes.effects) }
    this.mixer = new AudioMixer({
      sampleRate: 48000,
      channels: 2,
      bitDepth: 16,
      generateSilence: true,
      autoClose: false,
    })
    this.mixer.pipe(this.output)
    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    })
    this.resource = createAudioResource<null>(this.output, {
      inputType: StreamType.Raw,
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

  playMusic(filePath: string) {
    this.stopBackground()
    this.background = this.spawnInput(filePath, this.volumes.music, true)
  }

  stopMusic() {
    this.stopBackground()
  }

  playEffect(filePath: string) {
    this.spawnInput(filePath, this.volumes.effects, false)
  }

  destroy() {
    this.stopBackground()
    this.mixer.destroy()
    this.player.stop(true)
    this.output.destroy()
  }

  private spawnInput(
    filePath: string,
    volume: number,
    loop: boolean,
  ): ActiveStream {
    const input = this.mixer.createAudioInput({
      sampleRate: 48000,
      channels: 2,
      bitDepth: 16,
      volume,
    })
    const ffmpeg = this.createFfmpeg(filePath)
    ffmpeg.pipe(input)
    ffmpeg.once('close', (_code) => {
      input.destroy()
      if (loop && this.background?.filePath === filePath) {
        this.background = this.spawnInput(filePath, volume, loop)
      }
    })
    ffmpeg.once('error', () => {
      input.destroy()
    })
    return { ffmpeg, input, loop, filePath, volume }
  }

  private createFfmpeg(filePath: string) {
    return new prism.FFmpeg({
      args: [
        '-re',
        '-i',
        filePath,
        '-analyzeduration',
        '0',
        '-loglevel',
        '0',
        '-af',
        'afade=t=in:st=0:d=0.05',
        '-f',
        's16le',
        '-ar',
        '48000',
        '-ac',
        '2',
      ],
    })
  }

  private stopBackground() {
    if (!this.background)
      return
    this.background.ffmpeg.removeAllListeners()
    this.background.ffmpeg.destroy()
    this.background.input.destroy()
    this.background = undefined
  }
}
