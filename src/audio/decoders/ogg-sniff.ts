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

/** Ogg page header: `OggS`, version, flags, granule (8), serial (4), sequence (4), CRC (4), then the segment count. */
const PAGE_HEADER_BYTES = 27

/**
 * The payload of the file's first Ogg page, where the logical stream's
 * codec-identification packet starts. `null` when the file is not Ogg or the
 * page is cut short before its payload.
 */
function firstPagePayload(bytes: Buffer): Buffer | null {
  if (bytes.length < PAGE_HEADER_BYTES || bytes.toString('ascii', 0, 4) !== 'OggS')
    return null
  const payloadStart = PAGE_HEADER_BYTES + bytes[PAGE_HEADER_BYTES - 1]
  return payloadStart <= bytes.length
    ? bytes.subarray(payloadStart)
    : null
}

/**
 * The codec the first page's payload opens with. Only its start counts: a
 * substring search would match `vorbis` in an Ogg FLAC's comment block or an
 * `OpusHead` on a later page, and so let a file pick the decoder it reaches (#784).
 */
function codecOf(payload: Buffer): OggCodec | null {
  if (payload.subarray(0, OPUS_ID.length).equals(OPUS_ID))
    return 'opus'
  if (payload.subarray(0, VORBIS_ID.length).equals(VORBIS_ID))
    return 'vorbis'
  return null
}

/**
 * The layout the identification header declares. Vorbis: version (4 bytes),
 * channels (1), sample rate (UInt32LE) after `\x01vorbis`. Opus: version (1),
 * channels (1) after `OpusHead`; the decoder always outputs 48 kHz, so the
 * header's input-rate field is informational and ignored. `null` when the
 * header is missing or cut short.
 */
function parseLayout(payload: Buffer): OggLayout | null {
  const codec = codecOf(payload)
  if (codec === 'opus') {
    return payload.length >= 10
      ? { codec, sampleRate: MIXER_SAMPLE_RATE, channels: payload[9] }
      : null
  }
  if (codec === 'vorbis') {
    return payload.length >= 16
      ? {
          codec,
          sampleRate: payload.readUInt32LE(12),
          channels: payload[11],
        }
      : null
  }
  return null
}

/** The first page's payload, read from the file's first few KB. */
async function readFirstPayload(filePath: string): Promise<Buffer | null> {
  const handle = await open(filePath, 'r')
  try {
    const head = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    return firstPagePayload(head.subarray(0, bytesRead))
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
    const payload = await readFirstPayload(filePath)
    const layout = payload && parseLayout(payload)
    if (!layout) {
      log.info(`${basename(filePath)} does not open with a complete Vorbis or Opus identification header; leaving it to the renderer`)
      return false
    }
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
  try {
    const payload = await readFirstPayload(filePath)
    return payload && codecOf(payload)
  }
  catch {
    return null
  }
}
