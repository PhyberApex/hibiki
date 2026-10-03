import type { Readable } from 'node:stream'
import { open } from 'node:fs/promises'
import { FLACDecoder } from '@wasm-audio-decoders/flac'
import { createProducerStream } from './pcm-stream'
import { readFileChunks } from './read-chunks'
import { createWasmDecoderEmitter } from './wasm-decoder-emitter'

/** Cheap "fLaC" magic-byte check. */
export async function probeFlac(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r')
  try {
    const header = Buffer.alloc(4)
    const { bytesRead } = await handle.read(header, 0, 4, 0)
    return bytesRead === 4 && header.toString('ascii') === 'fLaC'
  }
  catch {
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
  })
}
