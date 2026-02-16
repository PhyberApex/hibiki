import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Creates a minimal valid WAV file (PCM, mono, 44.1kHz, 16-bit, ~0.1s silence)
 * and returns the path. Caller can use it for upload tests and delete after.
 */
export function createMinimalWavPath(filename: string): string {
  const path = join(tmpdir(), filename)
  // RIFF header + fmt chunk + data chunk with a few silent samples
  const sampleRate = 44100
  const numChannels = 1
  const bitsPerSample = 16
  const blockAlign = numChannels * (bitsPerSample / 8)
  const byteRate = sampleRate * blockAlign
  const dataSize = 4096
  const chunkSize = 36 + dataSize

  const buffer = Buffer.alloc(44 + dataSize)
  let offset = 0

  function writeU32LE(v: number) {
    buffer.writeUInt32LE(v, offset)
    offset += 4
  }
  function writeU16LE(v: number) {
    buffer.writeUInt16LE(v, offset)
    offset += 2
  }

  buffer.write('RIFF', offset)
  offset += 4
  writeU32LE(chunkSize)
  buffer.write('WAVE', offset)
  offset += 4
  buffer.write('fmt ', offset)
  offset += 4
  writeU32LE(16)
  writeU16LE(1) // PCM
  writeU16LE(numChannels)
  writeU32LE(sampleRate)
  writeU32LE(byteRate)
  writeU16LE(blockAlign)
  writeU16LE(bitsPerSample)
  buffer.write('data', offset)
  offset += 4
  writeU32LE(dataSize)
  // rest of buffer is already 0 (silence)

  writeFileSync(path, buffer)
  return path
}
