import { PcmResampler } from './pcm-resample'

export interface WasmDecodedChunk {
  channelData: Float32Array[]
  samplesDecoded: number
  sampleRate: number
}

/**
 * Shared across the `wasm-audio-decoders`-family wrappers (flac, ogg-vorbis,
 * ogg-opus): their `decode()`/`flush()` calls can return an empty result
 * (no complete frame decoded yet), and the resampler can only be constructed
 * once the first real sample rate/channel count is known.
 */
export function createWasmDecoderEmitter(push: (chunk: Buffer) => Promise<void>) {
  let resampler: PcmResampler | null = null

  return async (result: WasmDecodedChunk): Promise<void> => {
    if (!result.channelData?.length || result.samplesDecoded === 0)
      return
    if (!resampler)
      resampler = new PcmResampler(result.sampleRate, result.channelData.length)
    await push(resampler.push(result.channelData))
  }
}
