import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import { createLogger } from '../../logger'
import { isSupportedPcmLayout, MIXER_SAMPLE_RATE } from './pcm-resample'

const log = createLogger('ogg-sniff')

export type OggCodec = 'vorbis' | 'opus'

interface OggLayout {
  codec: OggCodec
  sampleRate: number
  channels: number
}

const HEAD_BYTES = 8192
const VORBIS_ID = Buffer.from('\x01vorbis', 'latin1')
const OPUS_ID = Buffer.from('OpusHead', 'ascii')

/**
 * The layout the identification header declares. Vorbis: version (4 bytes),
 * channels (1), sample rate (UInt32LE) after `\x01vorbis`. Opus: version (1),
 * channels (1) after `OpusHead`; the decoder always outputs 48 kHz, so the
 * header's input-rate field is informational and ignored. `null` when the
 * header is missing or cut short.
 */
function parseLayout(bytes: Buffer): OggLayout | null {
  const opus = bytes.indexOf(OPUS_ID)
  if (opus !== -1) {
    return opus + 10 <= bytes.length
      ? { codec: 'opus', sampleRate: MIXER_SAMPLE_RATE, channels: bytes[opus + 9] }
      : null
  }
  const vorbis = bytes.indexOf(VORBIS_ID)
  if (vorbis !== -1) {
    return vorbis + 16 <= bytes.length
      ? {
          codec: 'vorbis',
          sampleRate: bytes.readUInt32LE(vorbis + 12),
          channels: bytes[vorbis + 11],
        }
      : null
  }
  return null
}

async function readHead(filePath: string): Promise<Buffer | null> {
  const handle = await open(filePath, 'r')
  try {
    const head = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    const bytes = head.subarray(0, bytesRead)
    return bytes.toString('ascii', 0, 4) === 'OggS'
      ? bytes
      : null
  }
  finally {
    await handle.close()
  }
}

/**
 * Whether the backend decodes this Ogg file: a recognised codec whose
 * identification header declares a sample rate and channel count
 * `PcmResampler` accepts. Vorbis allows 1 Hz, which would otherwise reach the
 * resampler and fail mid-playback instead of taking the renderer fallback (#765).
 */
export async function probeOgg(filePath: string): Promise<boolean> {
  try {
    const head = await readHead(filePath)
    const layout = head && parseLayout(head)
    if (!layout)
      return false
    if (!isSupportedPcmLayout(layout.sampleRate, layout.channels)) {
      log.info(`${basename(filePath)} declares ${layout.codec} at ${layout.sampleRate} Hz, ${layout.channels} channel(s), outside what the backend decodes`)
      return false
    }
    return true
  }
  catch (err) {
    log.info(`${basename(filePath)} failed the Ogg probe:`, err)
    return false
  }
}

/**
 * An Ogg container can hold Vorbis or Opus; the `.ogg`/`.opus`/`.oga` extension
 * alone doesn't say which. The first Ogg page's payload starts with a
 * codec-identification header: `\x01vorbis` or `OpusHead`. Reading that page
 * is cheap (a few KB at most), well short of decoding the file.
 */
export async function sniffOggCodec(filePath: string): Promise<OggCodec | null> {
  const handle = await open(filePath, 'r')
  try {
    const head = Buffer.alloc(8192)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    const bytes = head.subarray(0, bytesRead)
    if (bytes.toString('ascii', 0, 4) !== 'OggS')
      return null
    if (bytes.includes('OpusHead'))
      return 'opus'
    if (bytes.includes('vorbis'))
      return 'vorbis'
    return null
  }
  catch {
    return null
  }
  finally {
    await handle.close()
  }
}
