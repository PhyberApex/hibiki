import type { Readable } from 'node:stream'
import { extname } from 'node:path'
import { createFlacPcmStream, probeFlac } from './flac-decoder'
import { createMp3PcmStream, probeMp3 } from './mp3-decoder'
import { createOggOpusPcmStream } from './ogg-opus-decoder'
import { sniffOggCodec } from './ogg-sniff'
import { createOggVorbisPcmStream } from './ogg-vorbis-decoder'
import { createWavPcmStream, probeWav } from './wav-decoder'

export { MIXER_CHANNELS, MIXER_SAMPLE_RATE } from './pcm-resample'

interface FormatDecoder {
  probe: (filePath: string) => Promise<boolean>
  create: (filePath: string) => Readable | Promise<Readable>
}

async function createOggStream(filePath: string): Promise<Readable> {
  const codec = await sniffOggCodec(filePath)
  if (codec === 'opus')
    return createOggOpusPcmStream(filePath)
  if (codec === 'vorbis')
    return createOggVorbisPcmStream(filePath)
  throw new Error(`Unrecognized Ogg codec in ${filePath}`)
}

const oggDecoder: FormatDecoder = {
  probe: async filePath => (await sniffOggCodec(filePath)) !== null,
  create: createOggStream,
}

/** One entry per supported extension (JS/WASM decoders only — see ADR-0003). An unlisted extension has no backend decoder. */
const DECODERS: Record<string, FormatDecoder> = {
  '.mp3': { probe: probeMp3, create: createMp3PcmStream },
  '.wav': { probe: probeWav, create: createWavPcmStream },
  '.flac': { probe: probeFlac, create: createFlacPcmStream },
  '.ogg': oggDecoder,
  '.oga': oggDecoder,
  '.opus': oggDecoder,
}

/**
 * Whether `createPcmStream` can decode this file in the main process. `false`
 * means the renderer fallback (audio element → chunked IPC) is used instead;
 * nothing in an existing library breaks. The probe reads at most a few KB,
 * never the whole file.
 */
export async function canDecode(filePath: string): Promise<boolean> {
  const decoder = DECODERS[extname(filePath).toLowerCase()]
  return decoder ? decoder.probe(filePath) : false
}

/** Decodes a Sound Library file into 48 kHz stereo signed 16-bit LE PCM for the mixer. Throws if `canDecode` would return false. */
export async function createPcmStream(filePath: string): Promise<Readable> {
  const decoder = DECODERS[extname(filePath).toLowerCase()]
  if (!decoder)
    throw new Error(`No backend decoder for ${filePath}`)
  return decoder.create(filePath)
}
