import type { Readable } from 'node:stream'
import { OggOpusDecoder } from 'ogg-opus-decoder'
import { createProducerStream } from './pcm-stream'
import { readFileChunks } from './read-chunks'
import { createWasmDecoderEmitter } from './wasm-decoder-emitter'

/**
 * Ogg Opus decodes straight to 48 kHz (libopus's native rate), so the
 * resampler here only ever up-mixes mono; `forceStereo` keeps that
 * up-mix inside the decoder instead.
 */
export function createOggOpusPcmStream(filePath: string): Readable {
  return createProducerStream(async (push) => {
    const decoder = new OggOpusDecoder({ forceStereo: true })
    await decoder.ready
    const emit = createWasmDecoderEmitter(push)

    try {
      for await (const chunk of readFileChunks(filePath))
        await emit(decoder.decode(chunk))
      await emit(await decoder.flush())
    }
    finally {
      decoder.free()
    }
  })
}
