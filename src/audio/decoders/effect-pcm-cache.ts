import type { Readable } from 'node:stream'
import { Readable as NodeReadable } from 'node:stream'

/** Effects are expected to be short (a door slam, a thunderclap), so this is an entry count, not a byte budget. */
const DEFAULT_MAX_ENTRIES = 16

/**
 * Keeps recently triggered Effects fully decoded in memory, keyed by file
 * path, so retriggering one skips paying its decoder start-up cost again
 * (each `createPcmStream` call spins up a fresh WASM decoder instance — see
 * ADR-0003). A cache miss decodes the file to completion before caching and
 * returning it; since Effects are short, this trades a little latency on
 * the first play for near-zero latency on every repeat, which is the common
 * case for a one-shot sound a GM triggers over and over in a session.
 * Bounded to `maxEntries`, evicting the least recently used entry.
 */
export class EffectPcmCache {
  private readonly cache = new Map<string, Buffer>()
  /** Decodes in flight, keyed the same way as `cache` — dedupes a cache-miss burst (e.g. a GM double-clicking an Effect that's never been played) into a single decode instead of racing separate WASM decoder instances for the same file. */
  private readonly pending = new Map<string, Promise<Buffer>>()

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  /**
   * Returns a fresh, independent Readable of `key`'s PCM data — from the
   * cache if already decoded (also refreshing its recency), otherwise by
   * running `decode()` to completion first (joining an already in-flight
   * decode for the same key, if there is one). A `decode()` that rejects or
   * whose stream errors is never cached, so the next request tries again
   * rather than being stuck replaying a partial/failed decode.
   *
   * Always hands out a *copy* of the cached bytes, never the cached
   * `Buffer` itself: the mixer (`node-audio-mixer`'s volume scaling)
   * mutates the PCM bytes it's given in place, and `Readable.from(buffer)`
   * streams out the exact same backing memory rather than a copy. Without
   * copying, playing a cached Effect at any volume other than 100 would
   * permanently attenuate the cached bytes themselves — and two layered
   * instances of the same Effect (an explicitly supported case) would race
   * on mutating that one shared buffer mid-playback.
   */
  async get(key: string, decode: () => Readable | Promise<Readable>): Promise<Readable> {
    const cached = this.cache.get(key)
    if (cached !== undefined) {
      this.bump(key, cached)
      return NodeReadable.from(Buffer.from(cached))
    }

    const buffer = await this.decodeOnce(key, decode)
    return NodeReadable.from(Buffer.from(buffer))
  }

  private decodeOnce(key: string, decode: () => Readable | Promise<Readable>): Promise<Buffer> {
    const inFlight = this.pending.get(key)
    if (inFlight)
      return inFlight

    const decoding = (async () => readAll(await decode()))()
      .then((buffer) => {
        this.bump(key, buffer)
        return buffer
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, decoding)
    return decoding
  }

  /** Inserts/refreshes `key` as the most recently used entry, evicting the least recently used one if that pushes the cache over `maxEntries`. */
  private bump(key: string, buffer: Buffer): void {
    this.cache.delete(key)
    this.cache.set(key, buffer)
    if (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined)
        this.cache.delete(oldestKey)
    }
  }
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

export function createEffectPcmCache(maxEntries?: number): EffectPcmCache {
  return new EffectPcmCache(maxEntries)
}
