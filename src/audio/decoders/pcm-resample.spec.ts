import {
  isSupportedPcmLayout,
  MAX_INPUT_CHANNELS,
  MAX_INPUT_SAMPLE_RATE,
  MIN_INPUT_SAMPLE_RATE,
  MIXER_SAMPLE_RATE,
  PcmResampler,
} from './pcm-resample'

function ramp(length: number, from = 0, step = 0.001): Float32Array {
  return Float32Array.from({ length }, (_, i) => from + i * step)
}

/** The pre-#765 algorithm (growing number[]), kept here as the reference the pre-sized rewrite must match sample for sample. */
function referenceResample(chunks: Float32Array[][], inputRate: number, inputChannels: number): Buffer {
  const step = inputRate / MIXER_SAMPLE_RATE
  let phase = 0
  let lastSamples: number[] | null = null
  const out: Buffer[] = []
  const clamp = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)))
  for (const chunkData of chunks) {
    const channels = chunkData.slice(0, inputChannels)
    const length = channels[0].length
    if (!lastSamples)
      lastSamples = channels.map(c => c[0])
    const samples: number[] = []
    let pos = phase
    while (pos < length) {
      const i = Math.floor(pos)
      const frac = pos - i
      for (let c = 0; c < channels.length; c++) {
        const prev = i === 0
          ? lastSamples[c]
          : channels[c][i - 1]
        samples.push(prev + (channels[c][i] - prev) * frac)
      }
      pos += step
    }
    phase = pos - length
    lastSamples = channels.map(c => c[c.length - 1])
    const frames = samples.length / channels.length
    const buf = Buffer.alloc(frames * 4)
    for (let f = 0; f < frames; f++) {
      const left = samples[f * channels.length]
      const right = channels.length >= 2
        ? samples[f * channels.length + 1]
        : left
      buf.writeInt16LE(clamp(left * 32767), f * 4)
      buf.writeInt16LE(clamp(right * 32767), f * 4 + 2)
    }
    out.push(buf)
  }
  return Buffer.concat(out)
}

describe('isSupportedPcmLayout', () => {
  it.each([
    [MIN_INPUT_SAMPLE_RATE, 1],
    [8000, 2],
    [44100, 2],
    [MAX_INPUT_SAMPLE_RATE, MAX_INPUT_CHANNELS],
  ])('accepts %p Hz with %p channel(s)', (rate, channels) => {
    expect(isSupportedPcmLayout(rate, channels)).toBe(true)
  })

  it.each([
    [0, 2],
    [1, 2],
    [MIN_INPUT_SAMPLE_RATE - 1, 2],
    [MAX_INPUT_SAMPLE_RATE + 1, 2],
    [Number.NaN, 2],
    [44100.5, 2],
    [44100, 0],
    [44100, MAX_INPUT_CHANNELS + 1],
    [44100, 65535],
    [44100, 1.5],
  ])('rejects %p Hz with %p channel(s)', (rate, channels) => {
    expect(isSupportedPcmLayout(rate, channels)).toBe(false)
  })
})

describe('pcmResampler', () => {
  it.each([
    [1, 2],
    [100, 2],
    [MIN_INPUT_SAMPLE_RATE - 1, 2],
    [MAX_INPUT_SAMPLE_RATE + 1, 2],
    [44100, 0],
    [44100, MAX_INPUT_CHANNELS + 1],
    [44100, 65535],
  ])('refuses a %p Hz, %p-channel input (#765)', (rate, channels) => {
    expect(() => new PcmResampler(rate, channels)).toThrow(/Unsupported PCM input/)
  })

  it('caps the output of a single push at the lowest accepted rate to 12x the input frames', () => {
    const resampler = new PcmResampler(MIN_INPUT_SAMPLE_RATE, 1)
    const out = resampler.push([
      ramp(200),
    ])
    expect(out.length).toBe(200 * (MIXER_SAMPLE_RATE / MIN_INPUT_SAMPLE_RATE) * 4)
  })

  it('throws instead of allocating when one push would exceed the per-call output ceiling', () => {
    const resampler = new PcmResampler(MIN_INPUT_SAMPLE_RATE, 1)
    expect(() => resampler.push([
      new Float32Array(1 << 20),
    ])).toThrow(/output ceiling/)
  })

  it.each([
    [44100, 2],
    [22050, 1],
    [8000, 2],
    [96000, 6],
    [48000, 2],
  ])('matches the reference resampler across chunk boundaries at %p Hz, %p channel(s)', (rate, channels) => {
    const chunks = [37, 1024, 3, 1, 500].map((len, k) => Array.from(
      { length: channels },
      (_, c) => ramp(len, (k * 0.1 + c * 0.05) - 0.4, 0.0007),
    ))
    const resampler = new PcmResampler(rate, channels)
    const actual = Buffer.concat(chunks.map(c => resampler.push(c)))
    expect(actual.equals(referenceResample(chunks, rate, channels))).toBe(true)
  })

  it('returns an empty buffer for an empty chunk', () => {
    expect(new PcmResampler(44100, 2).push([
      new Float32Array(0),
      new Float32Array(0),
    ]).length).toBe(0)
  })
})
