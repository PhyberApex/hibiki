export const MIXER_SAMPLE_RATE = 48000
export const MIXER_CHANNELS = 2

/**
 * Accepted input layout. Every number here comes out of a sound file, so it is
 * untrusted: a 1 Hz rate (legal in FLAC STREAMINFO and Ogg Vorbis) made one
 * push() emit 96000 output frames per input sample synchronously on the main
 * process, and a WAV can declare 65535 channels (#765). 4 kHz keeps the worst
 * amplification at 12x; 192 kHz and 8 channels (7.1) cover every real file.
 * Anything outside goes to the renderer fallback via the probes.
 */
export const MIN_INPUT_SAMPLE_RATE = 4000
export const MAX_INPUT_SAMPLE_RATE = 192000
export const MAX_INPUT_CHANNELS = 8

/**
 * Most output frames one push() may produce (about 21.8 s, 4 MiB). Far above
 * any decoder's chunk (a maximal 65535-sample FLAC block at 4 kHz is ~786k)
 * and only a backstop: the output buffer is sized before the loop runs, so the
 * check happens before any allocation.
 */
export const MAX_PUSH_OUTPUT_FRAMES = 1 << 20

const BYTES_PER_OUTPUT_FRAME = MIXER_CHANNELS * 2

const CLAMP_16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)))

/** Whether a decoder-reported sample rate and channel count are within what `PcmResampler` accepts. */
export function isSupportedPcmLayout(sampleRate: number, channels: number): boolean {
  return Number.isInteger(sampleRate)
    && sampleRate >= MIN_INPUT_SAMPLE_RATE
    && sampleRate <= MAX_INPUT_SAMPLE_RATE
    && Number.isInteger(channels)
    && channels >= 1
    && channels <= MAX_INPUT_CHANNELS
}

/**
 * Converts decoded Float32 channel data at an arbitrary sample rate/channel
 * count into 48 kHz stereo signed 16-bit little-endian PCM, the format
 * `AudioEngine`'s mixer inputs expect. Stateful across calls so a decoder's
 * chunked output resamples as one continuous stream instead of clicking at
 * chunk boundaries. Only the first two channels reach the output.
 */
export class PcmResampler {
  private readonly step: number
  /** Fractional read position, in input samples, into the next push()'s data. */
  private phase = 0
  /** Last sample of the previous chunk per channel, used as interpolation anchor. */
  private lastSamples: number[] | null = null

  constructor(private readonly inputSampleRate: number, private readonly inputChannels: number) {
    if (!isSupportedPcmLayout(inputSampleRate, inputChannels))
      throw new Error(`Unsupported PCM input: ${inputSampleRate} Hz, ${inputChannels} channel(s); accepted ${MIN_INPUT_SAMPLE_RATE}-${MAX_INPUT_SAMPLE_RATE} Hz, 1-${MAX_INPUT_CHANNELS} channels`)
    this.step = inputSampleRate / MIXER_SAMPLE_RATE
  }

  /** Resamples one decoded chunk; returns interleaved stereo Int16LE PCM for it. */
  push(channelData: Float32Array[]): Buffer {
    const channels = channelData.slice(0, Math.min(this.inputChannels, MIXER_CHANNELS))
    const length = channels[0]?.length ?? 0
    if (length === 0)
      return Buffer.alloc(0)

    // Upper bound on the loop's iterations (+1 absorbs floating-point drift in `pos += step`).
    const maxFrames = this.phase < length
      ? Math.ceil((length - this.phase) / this.step) + 1
      : 0
    if (maxFrames > MAX_PUSH_OUTPUT_FRAMES)
      throw new Error(`PCM resample of ${length} input frames would exceed the ${MAX_PUSH_OUTPUT_FRAMES}-frame output ceiling`)

    if (!this.lastSamples)
      this.lastSamples = channels.map(c => c[0])

    const left = channels[0]
    const right = channels[1] ?? left
    const lastLeft = this.lastSamples[0]
    const lastRight = this.lastSamples[1] ?? lastLeft

    const output = Buffer.alloc(maxFrames * BYTES_PER_OUTPUT_FRAME)
    let written = 0
    let pos = this.phase
    while (pos < length) {
      const i = Math.floor(pos)
      const frac = pos - i
      const prevLeft = i === 0
        ? lastLeft
        : left[i - 1]
      const prevRight = i === 0
        ? lastRight
        : right[i - 1]
      const l = prevLeft + (left[i] - prevLeft) * frac
      const r = prevRight + (right[i] - prevRight) * frac
      output.writeInt16LE(CLAMP_16(l * 32767), written)
      output.writeInt16LE(CLAMP_16(r * 32767), written + 2)
      written += BYTES_PER_OUTPUT_FRAME
      pos += this.step
    }

    this.phase = pos - length
    this.lastSamples = channels.map(c => c[c.length - 1])

    return output.subarray(0, written)
  }
}
