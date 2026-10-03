import type { Readable } from 'node:stream'
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis'
import { PcmResampler } from './pcm-resample'
import { createProducerStream } from './pcm-stream'
import { readFileChunks } from './read-chunks'

export function createOggVorbisPcmStream(filePath: string): Readable {
  return createProducerStream(async (push) => {
    const decoder = new OggVorbisDecoder()
    await decoder.ready
    let resampler: PcmResampler | null = null

    const emit = async (result: { channelData: Float32Array[], samplesDecoded: number, sampleRate: number }) => {
      if (!result.channelData?.length || result.samplesDecoded === 0)
        return
      if (!resampler)
        resampler = new PcmResampler(result.sampleRate, result.channelData.length)
      await push(resampler.push(result.channelData))
    }

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
