import type { Readable } from 'node:stream'
import { createProducerStream, ProducerAbortedError } from './pcm-stream'

const HIGH_WATER_MARK = 16 * 1024

function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

describe('createProducerStream', () => {
  it('ends the stream with push(null) once the producer finishes on its own', async () => {
    const stream = createProducerStream(async (push) => {
      for (let i = 0; i < 8; i++)
        await push(Buffer.alloc(HIGH_WATER_MARK))
    })

    await expect(collect(stream)).resolves.toHaveLength(8 * HIGH_WATER_MARK)
    expect(stream.readableEnded).toBe(true)
  })

  it('runs the producer\'s finally after destroy() while it is parked in push', async () => {
    const cleanup = jest.fn()
    let parked = false
    const stream = createProducerStream(async (push) => {
      try {
        for (;;) {
          parked = true
          await push(Buffer.alloc(HIGH_WATER_MARK))
          parked = false
        }
      }
      finally {
        cleanup()
      }
    })

    await flush()
    expect(parked).toBe(true)
    expect(cleanup).not.toHaveBeenCalled()

    stream.destroy()
    await flush()

    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('rejects push once the stream is destroyed', async () => {
    let pushAfterDestroy: Promise<void> | undefined
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const stream = createProducerStream(async (push) => {
      await gate
      pushAfterDestroy = push(Buffer.alloc(4))
      await pushAfterDestroy
    })

    stream.destroy()
    release()
    await flush()

    await expect(pushAfterDestroy).rejects.toBeInstanceOf(ProducerAbortedError)
  })

  it('does not raise an error on the stream when it is aborted by destroy()', async () => {
    const stream = createProducerStream(async (push) => {
      for (;;) await push(Buffer.alloc(HIGH_WATER_MARK))
    })
    const onError = jest.fn()
    stream.on('error', onError)

    await flush()
    stream.destroy()
    await flush()

    expect(onError).not.toHaveBeenCalled()
  })

  it('destroys the stream with a real producer error', async () => {
    const stream = createProducerStream(async () => {
      throw new Error('decode failed')
    })

    await expect(collect(stream)).rejects.toThrow('decode failed')
  })
})
