import { PassThrough, Readable } from 'node:stream'
import { AudioMixer } from 'node-audio-mixer'
import { feedMixerInput, MIXER_PACKET_BYTES, MIXER_PACKET_MS } from './mixer-feed'

const STARTUP_PACKETS = 20
const OBSERVED_PACKETS = 60

function constantPcm(sample: number, packets: number): Readable {
  const chunk = Buffer.alloc(MIXER_PACKET_BYTES * 5)
  for (let i = 0; i < chunk.length; i += 2)
    chunk.writeInt16LE(sample, i)
  let remaining = packets * MIXER_PACKET_BYTES
  return new Readable({
    highWaterMark: MIXER_PACKET_BYTES * 10,
    read() {
      if (remaining <= 0) {
        this.push(null)
        return
      }
      const take = Math.min(chunk.length, remaining)
      remaining -= take
      this.push(chunk.subarray(0, take))
    },
  })
}

function sampleShare(output: Buffer): Record<number, number> {
  const counts = new Map<number, number>()
  for (let i = 0; i < output.length; i += 2) {
    const v = output.readInt16LE(i)
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const total = output.length / 2
  return Object.fromEntries([
    ...counts.entries(),
  ].map(([v, n]) => [v, n / total]))
}

/**
 * Two inputs fed by independent, deliberately out-of-phase feeds, drained by
 * a consumer that pulls one packet per 20 ms like the voice player. Returns
 * the share of each sample value seen after the startup window.
 */
async function mixTwoConstantInputs(mixer: AudioMixer): Promise<Record<number, number>> {
  const output = new PassThrough()
  mixer.pipe(output)
  const makeInput = () => mixer.createAudioInput({
    sampleRate: 48000,
    channels: 2,
    bitDepth: 16,
    volume: 100,
  })
  const a = makeInput()
  const b = makeInput()
  const feedA = feedMixerInput(constantPcm(1000, 400), a)
  await new Promise(resolve => setTimeout(resolve, 7))
  const feedB = feedMixerInput(constantPcm(100, 400), b)

  const collected: Buffer[] = []
  for (let i = 0; i < STARTUP_PACKETS + OBSERVED_PACKETS; i++) {
    await new Promise(resolve => setTimeout(resolve, MIXER_PACKET_MS))
    const packet = output.read(MIXER_PACKET_BYTES) as Buffer | null
    if (packet && i >= STARTUP_PACKETS)
      collected.push(packet)
  }
  feedA.stop()
  feedB.stop()
  a.params = { forceClose: true }
  b.params = { forceClose: true }
  a.destroy()
  b.destroy()
  mixer.destroy()
  return sampleShare(Buffer.concat(collected))
}

function createEngineMixer(): AudioMixer {
  return new AudioMixer({
    sampleRate: 48000,
    channels: 2,
    bitDepth: 16,
    generateSilence: false,
    autoClose: false,
    highWaterMark: MIXER_PACKET_BYTES,
  })
}

describe('mixing two concurrently fed inputs', () => {
  it('with the engine configuration, every output sample carries both inputs', async () => {
    const share = await mixTwoConstantInputs(createEngineMixer())

    expect(share).toEqual({ 1100: 1 })
  })

  it('still mixes fully when every timer is as coarse as a Windows 15 ms tick', async () => {
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
      realSetTimeout(fn, Math.max(ms ?? 0, 15), ...args)) as typeof setTimeout
    try {
      const share = await mixTwoConstantInputs(createEngineMixer())

      expect(share).toEqual({ 1100: 1 })
    }
    finally {
      globalThis.setTimeout = realSetTimeout
    }
  })
})
