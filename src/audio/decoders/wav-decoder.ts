import type { FileHandle } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import { createLogger } from '../../logger'
import { isSupportedPcmLayout, PcmResampler } from './pcm-resample'
import { createProducerStream } from './pcm-stream'

const log = createLogger('wav-decoder')

const WAVE_FORMAT_PCM = 1
const WAVE_FORMAT_IEEE_FLOAT = 3
const WAVE_FORMAT_EXTENSIBLE = 0xFFFE

interface WavFormat {
  formatTag: number
  channels: number
  sampleRate: number
  bitsPerSample: number
  dataStart: number
  /** Bytes of sample data; `Infinity` for "read to end of file". */
  dataSize: number
}

/**
 * Data chunk sizes that mean "unknown, read to EOF": un-finalised or streamed
 * WAVs whose writer never patched the header (some recorders leave 0,
 * streaming writers use the 0xFFFFFFFF placeholder). Taking 0 literally made
 * such a file decode zero frames and "play out" instantly (#664).
 */
const DATA_SIZE_UNKNOWN = new Set([0, 0xFFFFFFFF])

/** Bytes of a fmt chunk that are ever read; WAVE_FORMAT_EXTENSIBLE needs 26 of its 40. A larger declared size is skipped past, never allocated (#765). */
const FMT_READ_LIMIT = 64
/** The PCMWAVEFORMAT core every fmt chunk carries; less is a truncated or corrupt header. */
const FMT_MIN_SIZE = 16
/** Frames read per decode step. */
const CHUNK_FRAMES = 16384
/** Ceiling on one sample-data read, independent of the file's declared frame size (#765). A backstop: `isSupportedFormat`'s 8-channel cap already keeps a chunk at 512 KiB. */
const MAX_READ_BYTES = 1 << 20

/**
 * Integer PCM at 8/16/24/32 bits or 32-bit IEEE float, at a sample rate and
 * channel count `PcmResampler` accepts; anything else (ADPCM, A-law, a 1 Hz
 * rate, 65535 channels, ...) is left to the renderer.
 */
function isSupportedFormat({ formatTag, bitsPerSample, sampleRate, channels }: WavFormat): boolean {
  if (!isSupportedPcmLayout(sampleRate, channels))
    return false
  if (formatTag === WAVE_FORMAT_IEEE_FLOAT)
    return bitsPerSample === 32
  return formatTag === WAVE_FORMAT_PCM && [8, 16, 24, 32].includes(bitsPerSample)
}

function describeFormat({ formatTag, bitsPerSample, sampleRate, channels }: WavFormat): string {
  return `tag ${formatTag}, ${bitsPerSample}-bit, ${sampleRate} Hz, ${channels} channel(s)`
}

/** RIFF/WAVE magic bytes plus a fmt chunk in a format `createWavPcmStream` decodes, found before the data chunk. Reads only chunk headers and fmt. */
export async function probeWav(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r')
  try {
    const header = Buffer.alloc(12)
    const { bytesRead } = await handle.read(header, 0, 12, 0)
    return bytesRead === 12
      && header.toString('ascii', 0, 4) === 'RIFF'
      && header.toString('ascii', 8, 12) === 'WAVE'
      && acceptsProbedFormat(filePath, await parseWavFormat(handle))
  }
  catch (err) {
    log.info(`${basename(filePath)} failed the WAV probe:`, err)
    return false
  }
  finally {
    await handle.close()
  }
}

function acceptsProbedFormat(filePath: string, format: WavFormat): boolean {
  const supported = isSupportedFormat(format)
  if (!supported)
    log.info(`${basename(filePath)} is a WAV format the backend does not decode (${describeFormat(format)})`)
  return supported
}

async function readChunkHeader(handle: FileHandle, offset: number): Promise<{ id: string, size: number } | null> {
  const header = Buffer.alloc(8)
  const { bytesRead } = await handle.read(header, 0, 8, offset)
  if (bytesRead < 8)
    return null
  return {
    id: header.toString('ascii', 0, 4),
    size: header.readUInt32LE(4),
  }
}

async function parseWavFormat(handle: FileHandle): Promise<WavFormat> {
  let offset = 12 // past "RIFF" size "WAVE"
  let fmt: { formatTag: number, channels: number, sampleRate: number, bitsPerSample: number } | null = null
  const { size: fileSize } = await handle.stat()

  for (;;) {
    const chunk = await readChunkHeader(handle, offset)
    if (!chunk)
      throw new Error('WAV file has no data chunk')
    const bodyOffset = offset + 8

    if (chunk.id === 'fmt ') {
      if (chunk.size < FMT_MIN_SIZE || bodyOffset + chunk.size > fileSize)
        throw new Error(`WAV fmt chunk declares ${chunk.size} bytes; the file holds ${Math.max(0, fileSize - bodyOffset)} after its header`)
      const readSize = Math.min(chunk.size, FMT_READ_LIMIT)
      const body = Buffer.alloc(readSize)
      const { bytesRead } = await handle.read(body, 0, readSize, bodyOffset)
      if (bytesRead < FMT_MIN_SIZE)
        throw new Error(`WAV fmt chunk is truncated: ${bytesRead} bytes read`)
      let formatTag = body.readUInt16LE(0)
      if (formatTag === WAVE_FORMAT_EXTENSIBLE && chunk.size >= 40 && bytesRead >= 26)
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
      return {
        ...fmt,
        dataStart: bodyOffset,
        dataSize: DATA_SIZE_UNKNOWN.has(chunk.size)
          ? Infinity
          : chunk.size,
      }
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
      else {
        // 32-bit integer; isSupportedFormat rules out every other depth.
        value = data.readInt32LE(offset) / 2147483648
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
      if (!isSupportedFormat(format))
        throw new Error(`Unsupported WAV format: ${describeFormat(format)}`)
      if (format.dataSize === Infinity)
        log.warn(`${basename(filePath)} declares no data chunk size; reading samples to end of file`)
      const resampler = new PcmResampler(format.sampleRate, format.channels)
      const bytesPerFrame = (format.bitsPerSample / 8) * format.channels
      const chunkBytes = Math.max(bytesPerFrame, Math.min(CHUNK_FRAMES, Math.floor(MAX_READ_BYTES / bytesPerFrame)) * bytesPerFrame)

      let remaining = format.dataSize
      let position = format.dataStart
      while (remaining > 0) {
        const toRead = Math.min(chunkBytes, remaining)
        const buffer = Buffer.alloc(toRead)
        const { bytesRead } = await handle.read(buffer, 0, toRead, position)
        if (bytesRead <= 0)
          break
        const usable = buffer.subarray(0, bytesRead - (bytesRead % bytesPerFrame))
        if (usable.length > 0) {
          for (const pcm of resampler.push(samplesToFloat32(usable, format)))
            await push(pcm)
        }
        position += bytesRead
        remaining -= bytesRead
      }
    }
    finally {
      await handle.close()
    }
  }, `wav ${basename(filePath)}`)
}
