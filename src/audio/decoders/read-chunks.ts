import { createReadStream } from 'node:fs'

const DEFAULT_CHUNK_SIZE = 64 * 1024

/** Reads a file in fixed-size chunks without loading it into memory at once. */
export async function* readFileChunks(filePath: string, chunkSize = DEFAULT_CHUNK_SIZE): AsyncGenerator<Uint8Array> {
  const stream = createReadStream(filePath, { highWaterMark: chunkSize })
  for await (const chunk of stream) yield chunk as Buffer
}
