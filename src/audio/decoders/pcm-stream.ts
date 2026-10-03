import { Readable } from 'node:stream'

/**
 * Builds a Readable whose bytes come from an async producer. `produce` receives
 * a `push` function it must await between chunks so a slow consumer (the mixer)
 * applies backpressure all the way back to the decode loop, instead of buffering
 * an entire decoded file in memory.
 */
export function createProducerStream(produce: (push: (chunk: Buffer) => Promise<void>) => Promise<void>): Readable {
  let resumeRead: (() => void) | null = null

  const stream = new Readable({
    read() {
      if (resumeRead) {
        const resume = resumeRead
        resumeRead = null
        resume()
      }
    },
  })

  const push = (chunk: Buffer): Promise<void> => {
    if (chunk.length === 0)
      return Promise.resolve()
    const canContinue = stream.push(chunk)
    if (canContinue)
      return Promise.resolve()
    return new Promise((resolve) => {
      resumeRead = resolve
    })
  }

  produce(push).then(
    () => stream.push(null),
    (err: unknown) => stream.destroy(err instanceof Error ? err : new Error(String(err))),
  )

  return stream
}
