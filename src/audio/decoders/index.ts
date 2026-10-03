import type { Readable } from 'node:stream'
import { extname } from 'node:path'
import { createFlacPcmStream, probeFlac } from './flac-decoder'
import { createMp3PcmStream } from './mp3-decoder'
import { createOggOpusPcmStream } from './ogg-opus-decoder'
import { sniffOggCodec } from './ogg-sniff'
import { createOggVorbisPcmStream } from './ogg-vorbis-decoder'
import { createWavPcmStream, probeWav } from './wav-decoder'

export { MIXER_CHANNELS, MIXER_SAMPLE_RATE } from './pcm-resample'

/**
 * Whether `createPcmStream` can decode this file in the main process (JS/WASM
 * decoders only — see ADR-0003). `false` means the renderer fallback (audio
 * element → chunked IPC) is used instead; nothing in an existing library
 * breaks. The probe reads at most a few KB, never the whole file.
 */
export async function canDecode(filePath: string): Promise<boolean> {
  switch (extname(filePath).toLowerCase()) {
    case '.mp3':
      return true
    case '.wav':
      return probeWav(filePath)
    case '.flac':
      return probeFlac(filePath)
    case '.ogg':
    case '.oga':
    case '.opus':
      return (await sniffOggCodec(filePath)) !== null
    default:
      return false
  }
}

/** Decodes a Sound Library file into 48 kHz stereo signed 16-bit LE PCM for the mixer. Throws if `canDecode` would return false. */
export async function createPcmStream(filePath: string): Promise<Readable> {
  switch (extname(filePath).toLowerCase()) {
    case '.mp3':
      return createMp3PcmStream(filePath)
    case '.wav':
      return createWavPcmStream(filePath)
    case '.flac':
      return createFlacPcmStream(filePath)
    case '.ogg':
    case '.oga':
    case '.opus': {
      const codec = await sniffOggCodec(filePath)
      if (codec === 'opus')
        return createOggOpusPcmStream(filePath)
      if (codec === 'vorbis')
        return createOggVorbisPcmStream(filePath)
      throw new Error(`Unrecognized Ogg codec in ${filePath}`)
    }
    default:
      throw new Error(`No backend decoder for ${filePath}`)
  }
}
