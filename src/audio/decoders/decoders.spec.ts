import type { Readable } from 'node:stream'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canDecode, createPcmStream, MIXER_CHANNELS, MIXER_SAMPLE_RATE } from './index'

const FIXTURES_DIR = join(__dirname, 'fixtures')
const BYTES_PER_FRAME = MIXER_CHANNELS * 2 // stereo, 16-bit

function fixture(name: string): string {
  return join(FIXTURES_DIR, name)
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

function durationMs(pcm: Buffer): number {
  const frames = pcm.length / BYTES_PER_FRAME
  return (frames / MIXER_SAMPLE_RATE) * 1000
}

describe('backend sound decoders', () => {
  const FIXTURE_DURATION_MS = 300
  const TOLERANCE_MS = 40

  it.each([
    ['mp3 (stereo, 44.1 kHz)', 'fixture-stereo-44100.mp3'],
    ['wav (mono, 22.05 kHz)', 'fixture-mono-22050.wav'],
    ['ogg vorbis (stereo, 44.1 kHz)', 'fixture-stereo-44100.ogg'],
    ['ogg opus (stereo, 48 kHz)', 'fixture-stereo-48000.opus'],
    ['flac (stereo, 44.1 kHz)', 'fixture-stereo-44100.flac'],
  ])('decodes %s into 48 kHz stereo 16-bit PCM of the right approximate duration', async (_label, filename) => {
    const path = fixture(filename)

    await expect(canDecode(path)).resolves.toBe(true)

    const stream = await createPcmStream(path)
    const pcm = await collect(stream)

    expect(pcm.length % BYTES_PER_FRAME).toBe(0)
    expect(pcm.length).toBeGreaterThan(0)
    expect(durationMs(pcm)).toBeGreaterThan(FIXTURE_DURATION_MS - TOLERANCE_MS)
    expect(durationMs(pcm)).toBeLessThan(FIXTURE_DURATION_MS + TOLERANCE_MS)
  })

  it('reports an m4a/AAC file as not decodable', async () => {
    await expect(canDecode(fixture('fixture.m4a'))).resolves.toBe(false)
  })

  it('reports a file with no recognized extension as not decodable', async () => {
    await expect(canDecode(fixture('does-not-exist.xyz'))).resolves.toBe(false)
  })

  it('createPcmStream throws for a format with no backend decoder', async () => {
    await expect(createPcmStream(fixture('fixture.m4a'))).rejects.toThrow()
  })

  it('reports a .mp3-named file with no MPEG magic bytes as not decodable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hibiki-decoders-'))
    const fakePath = join(dir, 'not-really.mp3')
    writeFileSync(fakePath, 'this is not an mp3 file')

    await expect(canDecode(fakePath)).resolves.toBe(false)
  })
})
