import type { Readable } from 'node:stream'
import { createLogger } from '../logger'
import { MIXER_CHANNELS, MIXER_SAMPLE_RATE } from './decoders/pcm-resample'

const log = createLogger('mixer-feed')

/** The subset of `node-audio-mixer`'s `AudioInput` the feed drives. */
export interface MixerFeedInput {
  readonly dataSize: number
  write: (chunk: Buffer) => boolean
  end: () => unknown
}

export interface MixerFeedOptions {
  /** Upper bound on the bytes queued inside the mixer input at any time. */
  leadBytes?: number
  /** How often to re-check the input for room (or for having drained) while waiting. */
  pollMs?: number
  /**
   * Called exactly once when playback has genuinely finished: the source
   * ended and every byte of it has left the mixer input, or the source
   * errored. Never called after `stop()`.
   */
  onEnded?: () => void
}

export interface MixerFeed {
  /** Detaches from the source and abandons any bytes not yet handed to the input. */
  stop: () => void
}

const BYTES_PER_FRAME = MIXER_CHANNELS * 2
const BYTES_PER_MS = (MIXER_SAMPLE_RATE * BYTES_PER_FRAME) / 1000

/** One 20 ms Discord packet of mixer-format PCM, the unit the mixer consumes per tick. */
export const MIXER_PACKET_MS = 20
export const MIXER_PACKET_BYTES = MIXER_PACKET_MS * BYTES_PER_MS

export const DEFAULT_LEAD_MS = 300
export const DEFAULT_LEAD_BYTES = DEFAULT_LEAD_MS * BYTES_PER_MS
const DEFAULT_POLL_MS = 20

/**
 * `node-audio-mixer` processes a written chunk through `chunk.buffer`, the
 * whole underlying `ArrayBuffer`, ignoring the view's offset and length. A
 * plain `subarray` of a larger decoded chunk would therefore enqueue the
 * entire chunk (and a pooled small `Buffer` would enqueue its pool), so every
 * write gets its own exactly-sized, unpooled allocation.
 */
function exactCopy(source: Buffer, length: number): Buffer {
  const copy = Buffer.alloc(length)
  source.copy(copy, 0, 0, length)
  return copy
}

/**
 * Pumps PCM from `source` into a mixer input while keeping only `leadBytes`
 * queued there. `node-audio-mixer`'s `AudioInput` acknowledges every write
 * immediately and holds whatever it is given, so piping a decoder into it
 * directly has no backpressure: the whole file lands in memory decoded, the
 * source's `end` fires seconds into a multi-minute track, and the input
 * bakes its `volume` into bytes as they arrive, so later volume changes only
 * affect what has not been written yet. Bounding the lead fixes all three:
 * memory stays flat, `onEnded` means the audio has actually played out, and
 * volume changes are heard within roughly `leadBytes` worth of audio.
 *
 * The source is read in paused mode, so the bytes it buffers while the feed
 * waits for room are capped by its own `highWaterMark`, which propagates the
 * backpressure to the decode loop behind it (see `createProducerStream`).
 *
 * The mixer only ever takes whole `MIXER_PACKET_BYTES` packets from an input
 * (`AudioEngine` sets that as its `highWaterMark`), so a trailing partial
 * packet would sit in the input forever and the feed would never see it
 * drain. The tail is padded with silence to a packet boundary before the
 * input is ended.
 */
export function feedMixerInput(source: Readable, input: MixerFeedInput, options: MixerFeedOptions = {}): MixerFeed {
  const leadBytes = options.leadBytes ?? DEFAULT_LEAD_BYTES
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS

  let pending: Buffer = Buffer.alloc(0)
  let timer: ReturnType<typeof setTimeout> | undefined
  let sourceEnded = false
  let inputEnded = false
  let done = false

  source.on('data', onData)
  source.once('end', onSourceEnd)
  source.once('error', onSourceError)

  return { stop: detach }

  function detach(): void {
    done = true
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    source.off('data', onData)
    source.off('end', onSourceEnd)
    source.off('error', onSourceError)
  }

  function finish(): void {
    if (done)
      return
    detach()
    options.onEnded?.()
  }

  function pollLater(): void {
    if (timer === undefined && !done)
      timer = setTimeout(pump, pollMs)
  }

  function pump(): void {
    timer = undefined
    if (done)
      return

    const room = Math.max(0, leadBytes - input.dataSize)
    const take = Math.min(pending.length, room - (room % BYTES_PER_FRAME))
    if (take > 0) {
      input.write(exactCopy(pending, take))
      pending = pending.subarray(take)
    }

    if (pending.length > 0) {
      pollLater()
      return
    }

    if (!sourceEnded) {
      source.resume()
      return
    }

    if (!inputEnded) {
      inputEnded = true
      const tail = input.dataSize % MIXER_PACKET_BYTES
      if (tail > 0) {
        log.debug(`Padding ${tail}-byte trailing partial packet with ${MIXER_PACKET_BYTES - tail} bytes of silence`)
        input.write(Buffer.alloc(MIXER_PACKET_BYTES - tail))
      }
      input.end()
    }
    if (input.dataSize === 0)
      finish()
    else
      pollLater()
  }

  function onData(chunk: Buffer): void {
    source.pause()
    pending = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk
    pump()
  }

  function onSourceEnd(): void {
    sourceEnded = true
    if (timer === undefined)
      pump()
  }

  function onSourceError(): void {
    finish()
  }
}
