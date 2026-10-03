export const MIXER_SAMPLE_RATE = 48000
export const MIXER_CHANNELS = 2

const CLAMP_16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)))

/**
 * Converts decoded Float32 channel data at an arbitrary sample rate/channel
 * count into 48 kHz stereo signed 16-bit little-endian PCM, the format
 * `AudioEngine`'s mixer inputs expect. Stateful across calls so a decoder's
 * chunked output resamples as one continuous stream instead of clicking at
 * chunk boundaries.
 */
export class PcmResampler {
  private readonly step: number
  /** Fractional read position, in input samples, into the next push()'s data. */
  private phase = 0
  /** Last sample of the previous chunk per channel, used as interpolation anchor. */
  private lastSamples: number[] | null = null

  constructor(private readonly inputSampleRate: number, private readonly inputChannels: number) {
    if (inputSampleRate <= 0)
      throw new Error(`Invalid input sample rate: ${inputSampleRate}`)
    if (inputChannels < 1)
      throw new Error(`Invalid input channel count: ${inputChannels}`)
    this.step = inputSampleRate / MIXER_SAMPLE_RATE
  }

  /** Resamples one decoded chunk; returns interleaved stereo Int16LE PCM for it. */
  push(channelData: Float32Array[]): Buffer {
    const channels = channelData.slice(0, this.inputChannels)
    const length = channels[0]?.length ?? 0
    if (length === 0)
      return Buffer.alloc(0)

    if (!this.lastSamples)
      this.lastSamples = channels.map(c => c[0])

    const output: number[] = []
    let pos = this.phase
    while (pos < length) {
      const i = Math.floor(pos)
      const frac = pos - i
      for (let c = 0; c < channels.length; c++) {
        const prev = i === 0 ? this.lastSamples[c] : channels[c][i - 1]
        const curr = channels[c][i]
        output.push(prev + (curr - prev) * frac)
      }
      pos += this.step
    }

    this.phase = pos - length
    this.lastSamples = channels.map(c => c[c.length - 1])

    return this.toStereoInt16(output, channels.length)
  }

  private toStereoInt16(samples: number[], channels: number): Buffer {
    const frames = samples.length / channels
    const buffer = Buffer.alloc(frames * MIXER_CHANNELS * 2)
    for (let f = 0; f < frames; f++) {
      const left = samples[f * channels]
      const right = channels >= 2 ? samples[f * channels + 1] : left
      buffer.writeInt16LE(CLAMP_16(left * 32767), f * 4)
      buffer.writeInt16LE(CLAMP_16(right * 32767), f * 4 + 2)
    }
    return buffer
  }
}
