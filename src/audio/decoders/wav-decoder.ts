import type { FileHandle } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { open } from 'node:fs/promises'
import { PcmResampler } from './pcm-resample'
import { createProducerStream } from './pcm-stream'

const WAVE_FORMAT_IEEE_FLOAT = 3
const WAVE_FORMAT_EXTENSIBLE = 0xFFFE

interface WavFormat {
  formatTag: number
  channels: number
  sampleRate: number
  bitsPerSample: number
  dataStart: number
  dataSize: number
}

/** Cheap RIFF/WAVE magic-byte check; does not validate the rest of the structure. */
export async function probeWav(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r')
  try {
    const header = Buffer.alloc(12)
    const { bytesRead } = await handle.read(header, 0, 12, 0)
    return bytesRead === 12
      && header.toString('ascii', 0, 4) === 'RIFF'
      && header.toString('ascii', 8, 12) === 'WAVE'
  }
  catch {
    return false
  }
  finally {
    await handle.close()
  }
}

async function readChunkHeader(handle: FileHandle, offset: number): Promise<{ id: string, size: number } | null> {
  const header = Buffer.alloc(8)
  const { bytesRead } = await handle.read(header, 0, 8, offset)
  if (bytesRead < 8)
    return null
  return { id: header.toString('ascii', 0, 4), size: header.readUInt32LE(4) }
}

async function parseWavFormat(handle: FileHandle): Promise<WavFormat> {
  let offset = 12 // past "RIFF" size "WAVE"
  let fmt: { formatTag: number, channels: number, sampleRate: number, bitsPerSample: number } | null = null

  for (;;) {
    const chunk = await readChunkHeader(handle, offset)
    if (!chunk)
      throw new Error('WAV file has no data chunk')
    const bodyOffset = offset + 8

    if (chunk.id === 'fmt ') {
      const body = Buffer.alloc(chunk.size)
      await handle.read(body, 0, chunk.size, bodyOffset)
      let formatTag = body.readUInt16LE(0)
      if (formatTag === WAVE_FORMAT_EXTENSIBLE && chunk.size >= 40)
        formatTag = body.readUInt16LE(24)
      fmt = {
        formatTag,
        channels: body.readUInt16LE(2),
        sampleRate: body.readUInt32LE(4),
        bitsPerSample: body.readUInt16LE(14),
      }
    }
    else if (chunk.id === 'data') {
      if (!fmt)
        throw new Error('WAV data chunk appeared before fmt chunk')
      return { ...fmt, dataStart: bodyOffset, dataSize: chunk.size }
    }

    offset = bodyOffset + chunk.size + (chunk.size % 2)
  }
}

function samplesToFloat32(data: Buffer, format: WavFormat): Float32Array[] {
  const { channels, bitsPerSample, formatTag } = format
  const bytesPerSample = bitsPerSample / 8
  const frames = Math.floor(data.length / (bytesPerSample * channels))
  const out: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(frames))

  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const offset = (f * channels + c) * bytesPerSample
      let value: number
      if (formatTag === WAVE_FORMAT_IEEE_FLOAT && bitsPerSample === 32) {
        value = data.readFloatLE(offset)
      }
      else if (bitsPerSample === 8) {
        value = (data.readUInt8(offset) - 128) / 128
      }
      else if (bitsPerSample === 16) {
        value = data.readInt16LE(offset) / 32768
      }
      else if (bitsPerSample === 24) {
        const b0 = data[offset]
        const b1 = data[offset + 1]
        const b2 = data[offset + 2]
        let sample = b0 | (b1 << 8) | (b2 << 16)
        if (sample & 0x800000)
          sample -= 0x1000000
        value = sample / 8388608
      }
      else if (bitsPerSample === 32) {
        value = data.readInt32LE(offset) / 2147483648
      }
      else {
        throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}`)
      }
      out[c][f] = value
    }
  }

  return out
}

export function createWavPcmStream(filePath: string): Readable {
  return createProducerStream(async (push) => {
    const handle = await open(filePath, 'r')
    try {
      const format = await parseWavFormat(handle)
      const resampler = new PcmResampler(format.sampleRate, format.channels)
      const bytesPerFrame = (format.bitsPerSample / 8) * format.channels
      const chunkFrames = 16384
      const chunkBytes = chunkFrames * bytesPerFrame

      let remaining = format.dataSize
      let position = format.dataStart
      while (remaining > 0) {
        const toRead = Math.min(chunkBytes, remaining)
        const buffer = Buffer.alloc(toRead)
        const { bytesRead } = await handle.read(buffer, 0, toRead, position)
        if (bytesRead <= 0)
          break
        const usable = buffer.subarray(0, bytesRead - (bytesRead % bytesPerFrame))
        if (usable.length > 0)
          await push(resampler.push(samplesToFloat32(usable, format)))
        position += bytesRead
        remaining -= bytesRead
      }
    }
    finally {
      await handle.close()
    }
  })
}
