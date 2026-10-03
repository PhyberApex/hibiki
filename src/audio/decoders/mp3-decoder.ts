import type { Readable } from 'node:stream'
import { MPEGDecoder } from 'mpg123-decoder'
import { PcmResampler } from './pcm-resample'
import { createProducerStream } from './pcm-stream'
import { readFileChunks } from './read-chunks'

export function createMp3PcmStream(filePath: string): Readable {
  return createProducerStream(async (push) => {
    const decoder = new MPEGDecoder()
    await decoder.ready
    let resampler: PcmResampler | null = null

    try {
      for await (const chunk of readFileChunks(filePath)) {
        const { channelData, samplesDecoded, sampleRate } = decoder.decode(chunk)
        if (samplesDecoded === 0)
          continue
        if (!resampler)
          resampler = new PcmResampler(sampleRate, channelData.length)
        await push(resampler.push(channelData))
      }
    }
    finally {
      decoder.free()
    }
  })
}
