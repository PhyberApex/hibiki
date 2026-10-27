import type { Readable } from 'node:stream'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MIXER_SAMPLE_RATE } from './pcm-resample'
import { createWavPcmStream, probeWav } from './wav-decoder'

const PCM = 1
const ADPCM = 2
const IEEE_FLOAT = 3
const A_LAW = 6
const EXTENSIBLE = 0xFFFE

interface WavSpec {
  formatTag?: number
  channels?: number
  sampleRate?: number
  bitsPerSample?: number
  /** Interleaved sample bytes for the data chunk. */
  data: Buffer
  /** Writes a 40-byte WAVE_FORMAT_EXTENSIBLE fmt chunk carrying `formatTag` as its sub-format. */
  extensible?: boolean
  /** Raw chunks inserted between fmt and data. */
  chunksBeforeData?: Buffer[]
  /** Declared data chunk size, when it should differ from `data.length`. */
  declaredDataSize?: number
  omitFmt?: boolean
  omitData?: boolean
}

function chunk(id: string, body: Buffer, declaredSize = body.length): Buffer {
  const header = Buffer.alloc(8)
  header.write(id, 0, 'ascii')
  header.writeUInt32LE(declaredSize, 4)
  const pad = body.length % 2
    ? Buffer.alloc(1)
    : Buffer.alloc(0)
  return Buffer.concat([header, body, pad])
}

function buildWav(spec: WavSpec): Buffer {
  const formatTag = spec.formatTag ?? PCM
  const channels = spec.channels ?? 2
  const sampleRate = spec.sampleRate ?? MIXER_SAMPLE_RATE
  const bitsPerSample = spec.bitsPerSample ?? 16
  const blockAlign = channels * bitsPerSample / 8

  const fmt = Buffer.alloc(spec.extensible ? 40 : 16)
  fmt.writeUInt16LE(spec.extensible ? EXTENSIBLE : formatTag, 0)
  fmt.writeUInt16LE(channels, 2)
  fmt.writeUInt32LE(sampleRate, 4)
  fmt.writeUInt32LE(sampleRate * blockAlign, 8)
  fmt.writeUInt16LE(blockAlign, 12)
  fmt.writeUInt16LE(bitsPerSample, 14)
  if (spec.extensible) {
    fmt.writeUInt16LE(22, 16) // cbSize
    fmt.writeUInt16LE(bitsPerSample, 18) // valid bits
    fmt.writeUInt32LE(0, 20) // channel mask
    fmt.writeUInt16LE(formatTag, 24) // first two bytes of the sub-format GUID
  }

  const body = Buffer.concat([
    Buffer.from('WAVE', 'ascii'),
    ...(spec.omitFmt
      ? []
      : [
          chunk('fmt ', fmt),
        ]),
    ...(spec.chunksBeforeData ?? []),
    ...(spec.omitData
      ? []
      : [
          chunk('data', spec.data, spec.declaredDataSize),
        ]),
  ])
  const riff = Buffer.alloc(8)
  riff.write('RIFF', 0, 'ascii')
  riff.writeUInt32LE(body.length, 4)
  return Buffer.concat([riff, body])
}

const dir = mkdtempSync(join(tmpdir(), 'hibiki-wav-'))
let fileCounter = 0

function writeTemp(bytes: Buffer | string): string {
  const path = join(dir, `case-${fileCounter++}.wav`)
  writeFileSync(path, bytes)
  return path
}

async function decode(bytes: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const c of createWavPcmStream(writeTemp(bytes)) as Readable) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

/** Interleaved stereo Int16LE output as [left, right] pairs. */
function frames(pcm: Buffer): [number, number][] {
  const out: [number, number][] = []
  for (let o = 0; o < pcm.length; o += 4) {
    out.push([
      pcm.readInt16LE(o),
      pcm.readInt16LE(o + 2),
    ])
  }
  return out
}

function repeat(sample: Buffer, count: number): Buffer {
  return Buffer.concat(Array.from<Buffer>({ length: count }).fill(sample))
}

function int24(value: number): Buffer {
  const b = Buffer.alloc(3)
  b.writeIntLE(value, 0, 3)
  return b
}

// +-0.5 of full scale after the resampler's `* 32767` and Math.round.
const HALF = 16384
const NEG_HALF = -16383
const N = 8

describe('probeWav', () => {
  it('accepts a RIFF/WAVE header', async () => {
    await expect(probeWav(writeTemp(buildWav({
      data: Buffer.alloc(4),
    })))).resolves.toBe(true)
  })

  it('rejects a file shorter than the 12-byte header', async () => {
    await expect(probeWav(writeTemp('RIFF'))).resolves.toBe(false)
  })

  it('rejects a 12-byte header without the WAVE form type', async () => {
    await expect(probeWav(writeTemp('RIFF\0\0\0\0AVI '))).resolves.toBe(false)
  })

  it('rejects a directory it cannot read', async () => {
    await expect(probeWav(dir)).resolves.toBe(false)
  })

  it.each([
    ['8-bit PCM', PCM, 8, false],
    ['32-bit PCM', PCM, 32, false],
    ['32-bit float', IEEE_FLOAT, 32, false],
    ['extensible 24-bit PCM', PCM, 24, true],
  ])('accepts %s', async (_label, formatTag, bitsPerSample, extensible) => {
    await expect(probeWav(writeTemp(buildWav({
      formatTag,
      bitsPerSample,
      extensible,
      data: Buffer.alloc(8),
    })))).resolves.toBe(true)
  })

  it.each([
    ['ADPCM', ADPCM, 4, false],
    ['A-law', A_LAW, 8, false],
    ['extensible ADPCM', ADPCM, 16, true],
    ['12-bit PCM', PCM, 12, false],
    ['64-bit float', IEEE_FLOAT, 64, false],
  ])('rejects %s so the renderer fallback plays it', async (_label, formatTag, bitsPerSample, extensible) => {
    await expect(probeWav(writeTemp(buildWav({
      formatTag,
      bitsPerSample,
      extensible,
      data: Buffer.alloc(8),
    })))).resolves.toBe(false)
  })

  it('rejects a file with no data chunk', async () => {
    await expect(probeWav(writeTemp(buildWav({
      data: Buffer.alloc(0),
      omitData: true,
    })))).resolves.toBe(false)
  })
})

describe('createWavPcmStream', () => {
  it.each([
    [
      '8-bit unsigned',
      8,
      PCM,
      repeat(Buffer.from([192]), N * 2),
    ],
    [
      '16-bit',
      16,
      PCM,
      repeat(Buffer.from([0x00, 0x40]), N * 2),
    ],
    [
      '24-bit',
      24,
      PCM,
      repeat(int24(0x400000), N * 2),
    ],
    [
      '32-bit integer',
      32,
      PCM,
      repeat(Buffer.from([0, 0, 0, 0x40]), N * 2),
    ],
    [
      '32-bit float',
      32,
      IEEE_FLOAT,
      (() => {
        const b = Buffer.alloc(4)
        b.writeFloatLE(0.5)
        return repeat(b, N * 2)
      })(),
    ],
  ])('decodes %s samples to the expected level', async (_label, bitsPerSample, formatTag, data) => {
    const out = frames(await decode(buildWav({ bitsPerSample, formatTag, data })))
    expect(out).toHaveLength(N)
    for (const [l, r] of out) {
      expect(l).toBe(HALF)
      expect(r).toBe(HALF)
    }
  })

  it('sign-extends negative 24-bit samples', async () => {
    const out = frames(await decode(buildWav({
      bitsPerSample: 24,
      data: repeat(int24(-0x400000), N * 2),
    })))
    expect(out[0]).toEqual([NEG_HALF, NEG_HALF])
  })

  it('reads the sub-format of a WAVE_FORMAT_EXTENSIBLE fmt chunk', async () => {
    const sample = Buffer.alloc(4)
    sample.writeFloatLE(-0.5)
    const out = frames(await decode(buildWav({
      extensible: true,
      formatTag: IEEE_FLOAT,
      bitsPerSample: 32,
      data: repeat(sample, N * 2),
    })))
    expect(out).toHaveLength(N)
    expect(out[0]).toEqual([NEG_HALF, NEG_HALF])
  })

  it('duplicates a mono channel into both stereo channels', async () => {
    const left = Buffer.from([0x00, 0x40])
    const out = frames(await decode(buildWav({
      channels: 1,
      data: repeat(left, N),
    })))
    expect(out).toHaveLength(N)
    expect(out.every(([l, r]) => l === HALF && r === HALF)).toBe(true)
  })

  it('keeps stereo channels apart', async () => {
    const frame = Buffer.from([0x00, 0x40, 0x00, 0xC0]) // +0.5, -0.5
    const out = frames(await decode(buildWav({
      data: repeat(frame, N),
    })))
    expect(out[0]).toEqual([HALF, NEG_HALF])
  })

  it('resamples non-48 kHz input through the PcmResampler', async () => {
    const out = frames(await decode(buildWav({
      sampleRate: 24000,
      data: repeat(Buffer.from([0x00, 0x40]), 2 * 100),
    })))
    expect(out).toHaveLength(200)
  })

  it('skips unknown and odd-sized chunks before data', async () => {
    const out = frames(await decode(buildWav({
      chunksBeforeData: [
        chunk('LIST', Buffer.from('INFOabc')),
        chunk('fact', Buffer.alloc(4)),
      ],
      data: repeat(Buffer.from([0x00, 0x40]), N * 2),
    })))
    expect(out).toHaveLength(N)
  })

  it('stops at the end of the file when data is truncated, dropping a trailing partial frame', async () => {
    const data = Buffer.concat([
      repeat(Buffer.from([0x00, 0x40]), N * 2),
      Buffer.from([0x00]),
    ])
    const out = frames(await decode(buildWav({ data, declaredDataSize: 1000 })))
    expect(out).toHaveLength(N)
  })

  it('rejects a file with no data chunk', async () => {
    await expect(decode(buildWav({
      data: Buffer.alloc(0),
      omitData: true,
    }))).rejects.toThrow('WAV file has no data chunk')
  })

  it('rejects a data chunk that comes before fmt', async () => {
    await expect(decode(buildWav({
      data: Buffer.alloc(4),
      omitFmt: true,
    }))).rejects.toThrow('WAV data chunk appeared before fmt chunk')
  })

  it.each([
    ['ADPCM', ADPCM, 16, false],
    ['A-law', A_LAW, 8, false],
    ['extensible ADPCM', ADPCM, 16, true],
    ['12-bit PCM', PCM, 12, false],
  ])('rejects %s, which probeWav would also refuse', async (_label, formatTag, bitsPerSample, extensible) => {
    await expect(decode(buildWav({
      formatTag,
      extensible,
      bitsPerSample,
      data: Buffer.alloc(24),
    })))
      .rejects
      .toThrow(`Unsupported WAV format: tag ${formatTag}, ${bitsPerSample}-bit`)
  })
})
