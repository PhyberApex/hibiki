import type { Readable } from 'node:stream'
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis'
import { createProducerStream } from './pcm-stream'
import { readFileChunks } from './read-chunks'
import { createWasmDecoderEmitter } from './wasm-decoder-emitter'

export function createOggVorbisPcmStream(filePath: string): Readable {
  return createProducerStream(async (push) => {
    const decoder = new OggVorbisDecoder()
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
  })
}
