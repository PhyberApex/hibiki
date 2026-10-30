import { Readable } from 'node:stream'
import { createLogger } from '../../logger'

const log = createLogger('pcm-stream')

/** What `push` rejects with once the stream is destroyed, so the producer unwinds through its `finally`. */
export class ProducerAbortedError extends Error {
  constructor() {
    super('PCM stream destroyed')
    this.name = 'AbortError'
  }
}

/**
 * Builds a Readable whose bytes come from an async producer. `produce` receives
 * a `push` function it must await between chunks so a slow consumer (the mixer)
 * applies backpressure all the way back to the decode loop, instead of buffering
 * an entire decoded file in memory.
 *
 * Node never calls `read()` on a destroyed Readable, so `destroy()` itself wakes
 * a producer parked in `push` by rejecting it with a `ProducerAbortedError`;
 * without that the producer's `finally` (freeing the decoder, closing the file)
 * never runs. `label` names the stream in the log. A producer that finishes
 * without pushing a single byte is logged as a warning: the stream still ends
 * normally, so the input "plays out" instantly, and without the line a GM's
 * "this sound does nothing" report has no trace (#664).
 */
export function createProducerStream(
  produce: (push: (chunk: Buffer) => Promise<void>) => Promise<void>,
  label = 'producer',
): Readable {
  let pending: { resolve: () => void, reject: (err: Error) => void } | null = null
  let aborted = false
  let bytesPushed = 0

  const stream = new Readable({
    read() {
      if (pending) {
        const { resolve } = pending
        pending = null
        resolve()
      }
    },
    destroy(err, callback) {
      aborted = true
      if (pending) {
        const { reject } = pending
        pending = null
        reject(new ProducerAbortedError())
      }
      callback(err)
    },
  })

  const push = (chunk: Buffer): Promise<void> => {
    if (aborted)
      return Promise.reject(new ProducerAbortedError())
    if (chunk.length === 0)
      return Promise.resolve()
    bytesPushed += chunk.length
    const canContinue = stream.push(chunk)
    if (canContinue)
      return Promise.resolve()
    return new Promise((resolve, reject) => {
      pending = { resolve, reject }
    })
  }

  produce(push).then(
    () => {
      if (aborted)
        return
      if (bytesPushed === 0)
        log.warn(`${label} decoded zero frames; it will play out instantly`)
      stream.push(null)
    },
    (err: unknown) => {
      if (err instanceof ProducerAbortedError) {
        log.debug(`${label} aborted by destroy`)
        return
      }
      if (aborted) {
        log.warn(`${label} failed after destroy:`, err)
        return
      }
      stream.destroy(err instanceof Error
        ? err
        : new Error(String(err)))
    },
  )

  return stream
}
