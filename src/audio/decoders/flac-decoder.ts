import type { Readable } from 'node:stream'
import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import { FLACDecoder } from '@wasm-audio-decoders/flac'
import { createLogger } from '../../logger'
import { isSupportedPcmLayout } from './pcm-resample'
import { createProducerStream } from './pcm-stream'
import { readFileChunks } from './read-chunks'
import { createWasmDecoderEmitter } from './wasm-decoder-emitter'

const log = createLogger('flac-decoder')

/** "fLaC", the 4-byte metadata block header, then the 34-byte STREAMINFO block the spec requires first. */
const HEADER_BYTES = 4 + 4 + 34
const STREAMINFO_TYPE = 0
/** STREAMINFO offset of the 20-bit sample rate / 3-bit channels-1 field, after the 10 bytes of block and frame sizes. */
const RATE_OFFSET = 8 + 10

/**
 * "fLaC" magic plus a STREAMINFO whose sample rate and channel count
 * `PcmResampler` accepts. STREAMINFO legitimately allows 1 Hz, which the
 * resampler would amplify 96000x (#765); such a file goes to the renderer
 * fallback instead.
 */
export async function probeFlac(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r')
  try {
    const header = Buffer.alloc(HEADER_BYTES)
    const { bytesRead } = await handle.read(header, 0, HEADER_BYTES, 0)
    if (bytesRead < HEADER_BYTES || header.toString('ascii', 0, 4) !== 'fLaC' || (header[4] & 0x7F) !== STREAMINFO_TYPE)
      return false
    const sampleRate = (header[RATE_OFFSET] << 12) | (header[RATE_OFFSET + 1] << 4) | (header[RATE_OFFSET + 2] >> 4)
    const channels = ((header[RATE_OFFSET + 2] >> 1) & 0x07) + 1
    if (!isSupportedPcmLayout(sampleRate, channels)) {
      log.info(`${basename(filePath)} declares ${sampleRate} Hz, ${channels} channel(s), outside what the backend decodes`)
      return false
    }
    return true
  }
  catch (err) {
    log.info(`${basename(filePath)} failed the FLAC probe:`, err)
    return false
  }
  finally {
    await handle.close()
  }
}

export function createFlacPcmStream(filePath: string): Readable {
  return createProducerStream(async (push) => {
    const decoder = new FLACDecoder()
    await decoder.ready
    const emit = createWasmDecoderEmitter(push)

    try {
      for await (const chunk of readFileChunks(filePath))
        await emit(await decoder.decode(chunk))
      await emit(await decoder.flush())
    }
    finally {
      decoder.free()
    }
  }, `flac ${basename(filePath)}`)
}
