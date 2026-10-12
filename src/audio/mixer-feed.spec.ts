import type { MixerFeedInput } from './mixer-feed'
import { once } from 'node:events'
import { PassThrough, Readable } from 'node:stream'
import { AudioMixer } from 'node-audio-mixer'
import { createProducerStream } from './decoders/pcm-stream'
import { DEFAULT_LEAD_BYTES, feedMixerInput } from './mixer-feed'

interface FakeInput extends MixerFeedInput {
  dataSize: number
  written: Buffer[]
  ended: boolean
  /** Simulates the mixer pulling `bytes` out of the input. */
  consume: (bytes: number) => void
}

function createFakeInput(): FakeInput {
  const input: FakeInput = {
    dataSize: 0,
    written: [],
    ended: false,
    write: (chunk: Buffer) => {
      input.written.push(Buffer.from(chunk))
      input.dataSize += chunk.length
      return true
    },
    end: () => {
      input.ended = true
    },
    consume: (bytes: number) => {
      input.dataSize = Math.max(0, input.dataSize - bytes)
    },
  }
  return input
}

const flush = () => new Promise(resolve => setImmediate(resolve))

describe('feedMixerInput', () => {
  describe('bounded lead', () => {
    beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] }))
    afterEach(() => jest.useRealTimers())

    it('never queues more than leadBytes inside the input', async () => {
      const source = new PassThrough()
      const input = createFakeInput()
      feedMixerInput(source, input, { leadBytes: 1000, pollMs: 20 })

      source.write(Buffer.alloc(2400))
      await flush()

      expect(input.dataSize).toBe(1000)
      expect(input.written).toHaveLength(1)
    })

    it('writes each slice as its own exactly-sized buffer, never a view into a larger one', async () => {
      const source = new PassThrough()
      const input = createFakeInput()
      const seen: Buffer[] = []
      input.write = (chunk: Buffer) => {
        seen.push(chunk)
        input.dataSize += chunk.length
        return true
      }
      feedMixerInput(source, input, { leadBytes: 1000, pollMs: 20 })

      source.write(Buffer.alloc(2400))
      await flush()
      input.consume(1000)
      jest.advanceTimersByTime(20)

      expect(seen).toHaveLength(2)
      for (const chunk of seen) {
        expect(chunk.byteOffset).toBe(0)
        expect(chunk.buffer.byteLength).toBe(chunk.length)
      }
    })

    it('writes whole frames only', async () => {
      const source = new PassThrough()
      const input = createFakeInput()
      feedMixerInput(source, input, { leadBytes: 1000, pollMs: 20 })
      input.dataSize = 990

      source.write(Buffer.alloc(100))
      await flush()

      expect(input.written[0].length).toBe(8)
    })

    it('tops the input back up as the mixer drains it, then resumes the source', async () => {
      const source = new PassThrough()
      const input = createFakeInput()
      feedMixerInput(source, input, { leadBytes: 1000, pollMs: 20 })

      source.write(Buffer.alloc(2400))
      await flush()
      input.consume(1000)
      jest.advanceTimersByTime(20)
      expect(input.dataSize).toBe(1000)
      input.consume(1000)
      jest.advanceTimersByTime(20)
      await flush()

      expect(input.dataSize).toBe(400)
      expect(Buffer.concat(input.written)).toHaveLength(2400)
    })

    it('applies backpressure to a producer stream instead of letting it run ahead', async () => {
      const input = createFakeInput()
      let produced = 0
      const source = createProducerStream(async (push) => {
        for (let i = 0; i < 100; i++) {
          produced++
          await push(Buffer.alloc(4096))
        }
      })
      feedMixerInput(source, input, { leadBytes: 8192, pollMs: 20 })

      for (let i = 0; i < 10; i++) await flush()

      expect(produced).toBeLessThan(20)
      expect(input.dataSize).toBeLessThanOrEqual(8192)
    })
  })

  describe('onEnded', () => {
    beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] }))
    afterEach(() => jest.useRealTimers())

    it('fires once the source has ended and the input has drained, ending the input first', async () => {
      const source = new PassThrough()
      const input = createFakeInput()
      const onEnded = jest.fn()
      feedMixerInput(source, input, { leadBytes: 1000, pollMs: 20, onEnded })

      source.write(Buffer.alloc(400))
      const ended = once(source, 'end')
      source.end()
      await ended
      await flush()

      expect(input.ended).toBe(true)
      expect(onEnded).not.toHaveBeenCalled()

      input.consume(400)
      jest.advanceTimersByTime(20)

      expect(onEnded).toHaveBeenCalledTimes(1)
    })

    it('fires immediately for a source that ends with nothing left queued', async () => {
      const source = new PassThrough()
      const input = createFakeInput()
      const onEnded = jest.fn()
      feedMixerInput(source, input, { onEnded })

      const ended = once(source, 'end')
      source.end()
      await ended

      expect(input.ended).toBe(true)
      expect(onEnded).toHaveBeenCalledTimes(1)
    })

    it('fires when the source errors', async () => {
      const source = new PassThrough()
      const input = createFakeInput()
      const onEnded = jest.fn()
      feedMixerInput(source, input, { onEnded })

      source.destroy(new Error('decode failed'))
      await flush()

      expect(onEnded).toHaveBeenCalledTimes(1)
    })

    it('does not fire, and stops writing, after stop()', async () => {
      const source = new PassThrough()
      const input = createFakeInput()
      const onEnded = jest.fn()
      const feed = feedMixerInput(source, input, { leadBytes: 1000, pollMs: 20, onEnded })

      source.write(Buffer.alloc(2400))
      await flush()
      feed.stop()
      input.consume(1000)
      jest.advanceTimersByTime(100)
      source.end()
      await flush()

      expect(input.dataSize).toBe(0)
      expect(input.written).toHaveLength(1)
      expect(onEnded).not.toHaveBeenCalled()
    })
  })

  describe('against the real mixer', () => {
    it('streams a whole file through at bounded lead and reports the end after playout', async () => {
      const mixer = new AudioMixer({ sampleRate: 48000, channels: 2, bitDepth: 16, generateSilence: false, autoClose: false })
      const sink = new PassThrough()
      let outBytes = 0
      sink.on('data', (chunk: Buffer) => {
        outBytes += chunk.length
      })
      mixer.pipe(sink)
      const input = mixer.createAudioInput({ sampleRate: 48000, channels: 2, bitDepth: 16, volume: 100 })

      const totalBytes = 10 * DEFAULT_LEAD_BYTES
      const source = Readable.from(Array.from({ length: 10 }, () => Buffer.alloc(DEFAULT_LEAD_BYTES, 1)))
      let peakQueued = 0
      const originalWrite = input.write.bind(input)
      input.write = ((chunk: Buffer) => {
        const result = originalWrite(chunk)
        peakQueued = Math.max(peakQueued, input.dataSize)
        return result
      }) as typeof input.write

      try {
        const ended = new Promise<void>((resolve) => {
          feedMixerInput(source, input, { pollMs: 5, onEnded: resolve })
        })
        await ended

        expect(peakQueued).toBeLessThanOrEqual(DEFAULT_LEAD_BYTES)
        expect(peakQueued).toBeGreaterThan(0)
        expect(input.dataSize).toBe(0)
        await flush()
        expect(outBytes).toBe(totalBytes)
      }
      finally {
        mixer.destroy()
      }
    })
  })
})
