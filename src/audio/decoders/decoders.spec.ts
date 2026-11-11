import type { ReadStream } from 'node:fs'
import type { Readable } from 'node:stream'
import { createReadStream, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canDecode, createPcmStream, MIXER_CHANNELS, MIXER_SAMPLE_RATE } from './index'
import { sniffOggCodec } from './ogg-sniff'

jest.mock('node:fs', () => {
  const actual = jest.requireActual('node:fs')
  return {
    ...actual,
    createReadStream: jest.fn(actual.createReadStream),
  }
})

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

  it.each([
    ['a 1 Hz', 1],
    ['a 100 Hz', 100],
    ['a 655350 Hz', 655350],
  ])('reports a FLAC whose STREAMINFO declares %s sample rate as not decodable (#765)', async (_label, rate) => {
    const bytes = readFileSync(fixture('fixture-stereo-44100.flac'))
    // STREAMINFO's 20-bit sample rate starts at byte 18 (after "fLaC", the block header and 10 bytes of sizes).
    bytes[18] = (rate >> 12) & 0xFF
    bytes[19] = (rate >> 4) & 0xFF
    bytes[20] = ((rate & 0x0F) << 4) | (bytes[20] & 0x0F)
    const dir = mkdtempSync(join(tmpdir(), 'hibiki-decoders-'))
    const path = join(dir, 'low-rate.flac')
    writeFileSync(path, bytes)

    await expect(canDecode(path)).resolves.toBe(false)
  })

  function patchedOgg(name: string, id: string, patch: (bytes: Buffer, at: number) => void): string {
    const bytes = readFileSync(fixture(name))
    const at = bytes.indexOf(Buffer.from(id, 'latin1'))
    patch(bytes, at)
    const dir = mkdtempSync(join(tmpdir(), 'hibiki-decoders-'))
    const path = join(dir, name)
    writeFileSync(path, bytes)
    return path
  }

  it.each([
    [
      'a 1 Hz sample rate',
      (b: Buffer, at: number) => b.writeUInt32LE(1, at + 12),
    ],
    [
      'zero channels',
      (b: Buffer, at: number) => b.writeUInt8(0, at + 11),
    ],
  ])('reports an Ogg Vorbis declaring %s as not decodable (#765)', async (_label, patch) => {
    await expect(canDecode(patchedOgg('fixture-stereo-44100.ogg', '\x01vorbis', patch))).resolves.toBe(false)
  })

  it('reports an Ogg Opus declaring 255 channels as not decodable (#765)', async () => {
    await expect(canDecode(patchedOgg('fixture-stereo-48000.opus', 'OpusHead', (b, at) => b.writeUInt8(255, at + 9)))).resolves.toBe(false)
  })

  /** One Ogg page (CRC left zero: the sniffer does not check it) carrying `payload` as a single packet. */
  function oggPage(payload: Buffer, sequence: number): Buffer {
    const header = Buffer.alloc(27)
    header.write('OggS', 0, 'ascii')
    header[5] = sequence === 0
      ? 0x02
      : 0x00
    header.writeUInt32LE(sequence, 18)
    const segments: number[] = []
    for (let left = payload.length; ; left -= 255) {
      segments.push(Math.min(left, 255))
      if (left < 255)
        break
    }
    header[26] = segments.length
    return Buffer.concat([
      header,
      Buffer.from(segments),
      payload,
    ])
  }

  function oggFile(name: string, ...payloads: Buffer[]): string {
    const dir = mkdtempSync(join(tmpdir(), 'hibiki-decoders-'))
    const path = join(dir, name)
    writeFileSync(path, Buffer.concat(payloads.map(oggPage)))
    return path
  }

  /** A Vorbis identification header declaring a stereo 44.1 kHz stream. */
  function vorbisIdHeader(): Buffer {
    const id = Buffer.alloc(30)
    id.write('\x01vorbis', 0, 'latin1')
    id[11] = 2
    id.writeUInt32LE(44100, 12)
    return id
  }

  it.each([
    ['Vorbis', 'fixture-stereo-44100.ogg', 'vorbis'],
    ['Opus', 'fixture-stereo-48000.opus', 'opus'],
  ])('sniffs the %s fixture from its first page', async (_label, name, codec) => {
    await expect(sniffOggCodec(fixture(name))).resolves.toBe(codec)
  })

  it('does not take an Ogg FLAC whose comments mention Vorbis for Vorbis (#784)', async () => {
    const path = oggFile(
      'flac-in-ogg.ogg',
      Buffer.concat([
        Buffer.from('\x7FFLAC\x01\x00\x00\x01fLaC', 'latin1'),
        Buffer.alloc(38),
      ]),
      Buffer.concat([
        Buffer.from('reference vorbis comment ', 'latin1'),
        vorbisIdHeader(),
      ]),
    )
    await expect(sniffOggCodec(path)).resolves.toBeNull()
    await expect(canDecode(path)).resolves.toBe(false)
  })

  it('does not take a later page\'s OpusHead for the stream\'s codec (#784)', async () => {
    const opusHead = readFileSync(fixture('fixture-stereo-48000.opus')).subarray(28, 47)
    const path = oggFile('skeleton-first.ogg', Buffer.from('fishead\x00', 'latin1'), opusHead)
    await expect(sniffOggCodec(path)).resolves.toBeNull()
    await expect(canDecode(path)).resolves.toBe(false)
  })

  it('reads the codec only from the start of the first page\'s payload (#784)', async () => {
    const path = oggFile('padded.ogg', Buffer.concat([
      Buffer.from('xx', 'latin1'),
      vorbisIdHeader(),
    ]))
    await expect(sniffOggCodec(path)).resolves.toBeNull()
    await expect(sniffOggCodec(oggFile('plain.ogg', vorbisIdHeader()))).resolves.toBe('vorbis')
  })

  it('refuses a first page cut short before its payload', async () => {
    const page = oggPage(vorbisIdHeader(), 0)
    const dir = mkdtempSync(join(tmpdir(), 'hibiki-decoders-'))
    const path = join(dir, 'cut.ogg')
    writeFileSync(path, page.subarray(0, 27))
    await expect(sniffOggCodec(path)).resolves.toBeNull()
    await expect(canDecode(path)).resolves.toBe(false)
  })

  it('reports a .flac-named file with only the magic bytes as not decodable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hibiki-decoders-'))
    const path = join(dir, 'magic-only.flac')
    writeFileSync(path, 'fLaC')

    await expect(canDecode(path)).resolves.toBe(false)
  })

  it('closes the file read stream when an mp3 stream is destroyed mid-decode', async () => {
    // Enough concatenated frames that the file is still being read when the decoder parks in push.
    const dir = mkdtempSync(join(tmpdir(), 'hibiki-decoders-'))
    const longPath = join(dir, 'long.mp3')
    const frame = readFileSync(fixture('fixture-stereo-44100.mp3'))
    writeFileSync(longPath, Buffer.concat(Array.from<Buffer>({ length: 50 }).fill(frame)))
    const opened: ReadStream[] = []
    const realCreateReadStream = jest.requireActual<typeof import('node:fs')>('node:fs').createReadStream
    jest.mocked(createReadStream).mockImplementationOnce((...args) => {
      const fileStream = realCreateReadStream(...args)
      opened.push(fileStream)
      return fileStream
    })

    const stream = await createPcmStream(longPath)
    await new Promise(resolve => stream.once('readable', resolve))
    await new Promise(resolve => setImmediate(resolve))
    const [fileStream] = opened
    expect(fileStream.closed).toBe(false)

    const fileClosed = new Promise(resolve => fileStream.once('close', resolve))
    stream.destroy()
    await fileClosed

    expect(fileStream.destroyed).toBe(true)
  })
})
