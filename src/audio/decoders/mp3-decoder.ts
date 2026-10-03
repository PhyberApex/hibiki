import type { Readable } from 'node:stream'
import { open } from 'node:fs/promises'
import { MPEGDecoder } from 'mpg123-decoder'
import { createProducerStream } from './pcm-stream'
import { readFileChunks } from './read-chunks'
import { createWasmDecoderEmitter } from './wasm-decoder-emitter'

/** Cheap magic-byte check: an ID3v2 tag, or an MPEG frame sync word at the start of the file. */
export async function probeMp3(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r')
  try {
    const header = Buffer.alloc(3)
    const { bytesRead } = await handle.read(header, 0, 3, 0)
    if (bytesRead < 3)
      return false
    if (header.toString('ascii', 0, 3) === 'ID3')
      return true
    return header[0] === 0xFF && (header[1] & 0xE0) === 0xE0
  }
  catch {
    return false
  }
  finally {
    await handle.close()
  }
}

export function createMp3PcmStream(filePath: string): Readable {
  return createProducerStream(async (push) => {
    const decoder = new MPEGDecoder()
    await decoder.ready
    const emit = createWasmDecoderEmitter(push)

    try {
      for await (const chunk of readFileChunks(filePath))
        await emit(decoder.decode(chunk))
    }
    finally {
      decoder.free()
    }
  })
}
