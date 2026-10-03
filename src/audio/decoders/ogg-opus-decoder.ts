import type { Readable } from 'node:stream'
import { OggOpusDecoder } from 'ogg-opus-decoder'
import { PcmResampler } from './pcm-resample'
import { createProducerStream } from './pcm-stream'
import { readFileChunks } from './read-chunks'

/**
 * Ogg Opus decodes straight to 48 kHz (libopus's native rate), so the
 * resampler here only ever up-mixes mono; `forceStereo` keeps that
 * up-mix inside the decoder instead.
 */
export function createOggOpusPcmStream(filePath: string): Readable {
  return createProducerStream(async (push) => {
    const decoder = new OggOpusDecoder({ forceStereo: true })
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
        await emit(decoder.decode(chunk))
      await emit(await decoder.flush())
    }
    finally {
      decoder.free()
    }
  })
}
