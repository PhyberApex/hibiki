import type { Readable } from 'node:stream'
import { basename } from 'node:path'
import { Readable as NodeReadable, pipeline, Transform } from 'node:stream'
import { createLogger } from '../../logger'
import { MIXER_CHANNELS, MIXER_SAMPLE_RATE } from './pcm-resample'

const log = createLogger('effect-pcm-cache')

/** Bytes per millisecond of 48 kHz stereo signed 16-bit PCM — the fixed format every decoder produces (see ADR-0003), so a decoded buffer's length alone gives its duration. */
const PCM_BYTES_PER_MS = (MIXER_SAMPLE_RATE * MIXER_CHANNELS * 2) / 1000

/** Effects are expected to be short (a door slam, a thunderclap); room for a couple of warmed Scenes' worth (#696). */
const DEFAULT_MAX_ENTRIES = 32
/** Total decoded PCM kept across every entry: 64 MiB, a little under six minutes of audio. */
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
/** One Effect decoding to more than a minute of PCM (~11.5 MB) is never cached (#664). */
const DEFAULT_MAX_ENTRY_BYTES = 60_000 * PCM_BYTES_PER_MS
/** Cache-miss decodes buffering at once (#773); each holds at most `maxEntryBytes` (plus one chunk) while it runs. */
const DEFAULT_MAX_CONCURRENT_DECODES = 2
/** Durations remembered for oversize Effects; each is a path and a number, so this only stops unbounded growth. */
const MAX_OVERSIZE_KEYS = 256

export interface EffectPcmCacheOptions {
  /** Most entries kept at once. */
  maxEntries?: number
  /** Most decoded PCM bytes kept across all entries. */
  maxBytes?: number
  /** Decoded size above which an Effect streams uncached instead; a decode is cut off as soon as it passes this. */
  maxEntryBytes?: number
  /** Most cache-miss decodes running at once; further ones wait their turn. */
  maxConcurrentDecodes?: number
}

export interface EffectPcmResult {
  stream: Readable
  /** Decoded duration in ms; 0 when not known yet (an oversize Effect that has never played to the end). */
  durationMs: number
}

export interface EffectPcmGetOptions {
  /** Aborting gives up on this request (rejecting with an `AbortError`); the shared decode itself is cancelled once no caller waits on it any more. */
  signal?: AbortSignal
}

type Decode = () => Readable | Promise<Readable>

/** A cache-miss decode in flight, shared by every caller asking for the same key. Resolves `undefined` when the Effect turned out to be over `maxEntryBytes`. */
interface PendingDecode {
  promise: Promise<Buffer | undefined>
  /** Callers still waiting on `promise`; the decode is cancelled when this drops to zero. */
  waiters: number
  controller: AbortController
}

/**
 * Keeps recently triggered Effects fully decoded in memory, keyed by file
 * path, so retriggering one skips paying its decoder start-up cost again
 * (each `createPcmStream` call spins up a fresh WASM decoder instance — see
 * ADR-0003). A cache miss decodes the file to completion before caching and
 * returning it; since Effects are short, this trades a little latency on
 * the first play for near-zero latency on every repeat, which is the common
 * case for a one-shot sound a GM triggers over and over in a session.
 * Bounded to `maxEntries` and `maxBytes`, evicting least recently used
 * entries first.
 *
 * A GM can still drop a five-minute track into Effects: caching that would
 * hold ~57 MB for the session, and every trigger would wait out the whole
 * decode (#664). So a decode is cut off the moment it passes
 * `maxEntryBytes` (#773: a file decoding to a gigabyte must never be read
 * into memory first), and that Effect streams from a fresh decoder on every
 * trigger, never retained. Its duration is unknown until one of those
 * uncached plays runs to the end, which is then remembered.
 *
 * At most `maxConcurrentDecodes` cache-miss decodes buffer at once, and a
 * caller that no longer needs its decode (an Effect Instance evicted or
 * stopped before it started) aborts it through `signal`.
 */
export class EffectPcmCache {
  private readonly cache = new Map<string, Buffer>()
  private cachedBytes = 0
  /** Decodes in flight, keyed the same way as `cache` — dedupes a cache-miss burst (e.g. a GM double-clicking an Effect that's never been played) into a single decode instead of racing separate WASM decoder instances for the same file. */
  private readonly pending = new Map<string, PendingDecode>()
  /** Effects found to be over `maxEntryBytes`, keyed like `cache`, with their duration once an uncached play has measured it (`null` until then). */
  private readonly oversize = new Map<string, number | null>()
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly maxEntryBytes: number
  private readonly maxConcurrentDecodes: number
  private activeDecodes = 0
  /** Decodes waiting for a slot, in arrival order; `grant` hands one the slot being released. */
  private readonly decodeQueue: Array<{ grant: () => void }> = []

  constructor(options: EffectPcmCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES
    this.maxConcurrentDecodes = Math.max(1, options.maxConcurrentDecodes ?? DEFAULT_MAX_CONCURRENT_DECODES)
  }

  /**
   * Returns a fresh, independent Readable of `key`'s PCM data, plus its
   * duration — from the cache if already decoded (also refreshing its
   * recency), otherwise by running `decode()` to completion first (joining
   * an already in-flight decode for the same key, if there is one). For a
   * cacheable Effect the whole file is decoded before this resolves, so
   * `durationMs` — the decoded buffer's byte length divided by the fixed PCM
   * byte rate — is known up front, before playback starts (see issue
   * #509). A `decode()` that rejects or whose stream errors is never
   * cached, so the next request tries again rather than being stuck
   * replaying a partial/failed decode.
   *
   * Always hands out a *copy* of the cached bytes, never the cached
   * `Buffer` itself: the mixer (`node-audio-mixer`'s volume scaling)
   * mutates the PCM bytes it's given in place, and `Readable.from(buffer)`
   * streams out the exact same backing memory rather than a copy. Without
   * copying, playing a cached Effect at any volume other than 100 would
   * permanently attenuate the cached bytes themselves — and two layered
   * instances of the same Effect (an explicitly supported case) would race
   * on mutating that one shared buffer mid-playback.
   *
   * An Effect over `maxEntryBytes` (known already, or found out by this
   * decode being cut off) instead gets a fresh decoder stream as is, with
   * its remembered duration or 0 while that is still unknown.
   */
  async get(key: string, decode: Decode, options: EffectPcmGetOptions = {}): Promise<EffectPcmResult> {
    if (this.oversize.has(key))
      return this.streamUncached(key, decode)

    const cached = this.cache.get(key)
    if (cached !== undefined) {
      this.bump(key, cached)
      return {
        stream: NodeReadable.from(Buffer.from(cached)),
        durationMs: durationOf(cached),
      }
    }

    const buffer = await this.decodeOnce(key, decode, options.signal)
    if (buffer === undefined)
      return this.streamUncached(key, decode)
    return {
      stream: NodeReadable.from(Buffer.from(buffer)),
      durationMs: durationOf(buffer),
    }
  }

  /**
   * Decodes `key` into the cache ahead of its first trigger (#696), so that
   * trigger lands as fast as a repeat. Already cached: only its recency is
   * refreshed. Known to be over `maxEntryBytes`: nothing to do, it streams
   * uncached anyway. Otherwise runs (or joins) the same decode `get` would.
   * Resolves `false` when the Effect turned out (or was already known) to be
   * over `maxEntryBytes`, so nothing is retained. Rejects when the decode
   * fails, leaving nothing cached.
   */
  async warm(key: string, decode: Decode): Promise<boolean> {
    if (this.oversize.has(key))
      return false
    const cached = this.cache.get(key)
    if (cached !== undefined) {
      this.bump(key, cached)
      return true
    }
    return (await this.decodeOnce(key, decode)) !== undefined
  }

  private async streamUncached(key: string, decode: Decode): Promise<EffectPcmResult> {
    const knownMs = this.oversize.get(key) ?? null
    log.debug(`Effect ${basename(key)} is over the cache cut-off; streaming it uncached (duration ${knownMs === null
      ? 'unknown'
      : `${knownMs} ms`})`)
    const stream = await decode()
    if (knownMs !== null)
      return { stream, durationMs: knownMs }
    return {
      stream: this.measureUncached(key, stream),
      durationMs: 0,
    }
  }

  /** Passes `stream` through untouched, counting its bytes; when it runs to the end, remembers the oversize Effect's duration for later triggers. */
  private measureUncached(key: string, stream: Readable): Readable {
    let bytes = 0
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        callback(null, chunk)
      },
    })
    pipeline(stream, counter, (err) => {
      if (err || !this.oversize.has(key))
        return
      const durationMs = Math.round(bytes / PCM_BYTES_PER_MS)
      this.oversize.set(key, durationMs)
      log.info(`Effect ${basename(key)} measured at ${durationMs} ms (${toMb(bytes)} MB) after an uncached play`)
    })
    return counter
  }

  private decodeOnce(key: string, decode: Decode, signal?: AbortSignal): Promise<Buffer | undefined> {
    if (signal?.aborted)
      return Promise.reject(abortError())
    let entry = this.pending.get(key)
    if (entry === undefined)
      entry = this.startDecode(key, decode)
    return this.waitFor(key, entry, signal)
  }

  private startDecode(key: string, decode: Decode): PendingDecode {
    const controller = new AbortController()
    const promise = (async () => {
      // Only yield when queued, so a free slot starts `decode()` in the same tick.
      if (!this.tryAcquireDecodeSlot())
        await this.waitForDecodeSlot(key, controller.signal)
      try {
        const stream = await decode()
        return await readBounded(stream, this.maxEntryBytes, controller.signal)
      }
      finally {
        this.releaseDecodeSlot()
      }
    })()
      .then((buffer) => {
        if (buffer === undefined)
          this.markOversize(key)
        else
          this.bump(key, buffer)
        return buffer
      })
      .finally(() => {
        if (this.pending.get(key)?.controller === controller)
          this.pending.delete(key)
      })
    // A cancelled decode has no waiter left to observe its rejection.
    promise.catch(() => {})
    const entry: PendingDecode = { promise, waiters: 0, controller }
    this.pending.set(key, entry)
    return entry
  }

  /** Waits on a shared decode for one caller; that caller aborting leaves the decode to the others, or cancels it when it was the last one waiting. */
  private waitFor(key: string, entry: PendingDecode, signal?: AbortSignal): Promise<Buffer | undefined> {
    entry.waiters++
    if (signal === undefined)
      return entry.promise
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        entry.waiters--
        if (entry.waiters === 0) {
          log.debug(`Cancelling the decode of Effect ${basename(key)}: no caller waits on it any more`)
          entry.controller.abort()
          if (this.pending.get(key) === entry)
            this.pending.delete(key)
        }
        reject(abortError())
      }
      signal.addEventListener('abort', onAbort, { once: true })
      entry.promise.then(
        (buffer) => {
          signal.removeEventListener('abort', onAbort)
          resolve(buffer)
        },
        (err: unknown) => {
          signal.removeEventListener('abort', onAbort)
          reject(err)
        },
      )
    })
  }

  private tryAcquireDecodeSlot(): boolean {
    if (this.activeDecodes >= this.maxConcurrentDecodes)
      return false
    this.activeDecodes++
    return true
  }

  private waitForDecodeSlot(key: string, signal: AbortSignal): Promise<void> {
    log.debug(`Effect ${basename(key)} waits for a decode slot (${this.activeDecodes} running, ${this.decodeQueue.length} queued)`)
    return new Promise<void>((resolve, reject) => {
      const waiter = { grant: resolve }
      const onAbort = () => {
        const index = this.decodeQueue.indexOf(waiter)
        if (index !== -1)
          this.decodeQueue.splice(index, 1)
        reject(abortError())
      }
      waiter.grant = () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }
      this.decodeQueue.push(waiter)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** Hands the slot straight to the next queued decode, if any. */
  private releaseDecodeSlot(): void {
    const next = this.decodeQueue.shift()
    if (next)
      next.grant()
    else
      this.activeDecodes--
  }

  private markOversize(key: string): void {
    log.warn(`Effect ${basename(key)} decodes to more than the ${toMb(this.maxEntryBytes)} MB cache cut-off; decode cut off there, streaming it uncached from now on`)
    this.oversize.set(key, null)
    if (this.oversize.size > MAX_OVERSIZE_KEYS) {
      const oldestKey = this.oversize.keys().next().value
      if (oldestKey !== undefined)
        this.oversize.delete(oldestKey)
    }
  }

  /** Inserts/refreshes `key` as the most recently used entry, then evicts least recently used ones while the cache is over `maxEntries` or `maxBytes` (never the entry just inserted). */
  private bump(key: string, buffer: Buffer): void {
    this.remove(key)
    this.cache.set(key, buffer)
    this.cachedBytes += buffer.length
    while (this.cache.size > 1 && (this.cache.size > this.maxEntries || this.cachedBytes > this.maxBytes)) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey === undefined)
        break
      log.debug(`Evicting Effect ${basename(oldestKey)} from the PCM cache (${this.cache.size} entries, ${toMb(this.cachedBytes)} MB)`)
      this.remove(oldestKey)
    }
  }

  private remove(key: string): void {
    const buffer = this.cache.get(key)
    if (buffer === undefined)
      return
    this.cache.delete(key)
    this.cachedBytes -= buffer.length
  }
}

/**
 * Reads `stream` into one buffer, or resolves `undefined` (destroying the
 * stream, so its decoder stops) as soon as more than `limit` bytes have come
 * through — at most `limit` plus one chunk is ever held. Aborting `signal`
 * destroys the stream and rejects with an `AbortError`.
 */
async function readBounded(stream: Readable, limit: number, signal: AbortSignal): Promise<Buffer | undefined> {
  if (signal.aborted) {
    stream.destroy()
    throw abortError()
  }
  const onAbort = () => stream.destroy(abortError())
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const chunks: Buffer[] = []
    let total = 0
    for await (const chunk of stream) {
      total += (chunk as Buffer).length
      if (total > limit) {
        stream.destroy()
        return undefined
      }
      chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks, total)
  }
  finally {
    signal.removeEventListener('abort', onAbort)
  }
}

function abortError(): Error {
  return new DOMException('The Effect decode was aborted', 'AbortError')
}

function durationOf(buffer: Buffer): number {
  return Math.round(buffer.length / PCM_BYTES_PER_MS)
}

function toMb(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1)
}

export function createEffectPcmCache(options?: EffectPcmCacheOptions): EffectPcmCache {
  return new EffectPcmCache(options)
}
