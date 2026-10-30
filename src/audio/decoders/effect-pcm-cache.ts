import type { Readable } from 'node:stream'
import { basename } from 'node:path'
import { Readable as NodeReadable } from 'node:stream'
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
/** Durations remembered for oversize Effects; each is a path and a number, so this only stops unbounded growth. */
const MAX_OVERSIZE_KEYS = 256

export interface EffectPcmCacheOptions {
  /** Most entries kept at once. */
  maxEntries?: number
  /** Most decoded PCM bytes kept across all entries. */
  maxBytes?: number
  /** Decoded size above which an Effect streams uncached instead. */
  maxEntryBytes?: number
}

export interface EffectPcmResult {
  stream: Readable
  durationMs: number
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
 * decode (#664). So an Effect whose decoded PCM exceeds `maxEntryBytes` is
 * played from that first decode but never retained; only its duration is
 * remembered, and every later trigger streams straight from a fresh decoder
 * with no up-front wait.
 */
export class EffectPcmCache {
  private readonly cache = new Map<string, Buffer>()
  private cachedBytes = 0
  /** Decodes in flight, keyed the same way as `cache` — dedupes a cache-miss burst (e.g. a GM double-clicking an Effect that's never been played) into a single decode instead of racing separate WASM decoder instances for the same file. */
  private readonly pending = new Map<string, Promise<Buffer>>()
  /** Durations of Effects found to be over `maxEntryBytes`, keyed like `cache`. */
  private readonly oversize = new Map<string, number>()
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly maxEntryBytes: number

  constructor(options: EffectPcmCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES
  }

  /**
   * Returns a fresh, independent Readable of `key`'s PCM data, plus its
   * duration — from the cache if already decoded (also refreshing its
   * recency), otherwise by running `decode()` to completion first (joining
   * an already in-flight decode for the same key, if there is one). The
   * whole file is always decoded before this resolves (cache hit and miss
   * alike), so `durationMs` — the decoded buffer's byte length divided by
   * the fixed PCM byte rate — is known up front, before playback starts; no
   * decoder changes are needed for this (see issue #509). A `decode()` that
   * rejects or whose stream errors is never cached, so the next request
   * tries again rather than being stuck replaying a partial/failed decode.
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
   * The one exception to "decoded up front" is an Effect already known to
   * be over `maxEntryBytes`: its fresh decoder stream is returned as is,
   * with the duration remembered from its first decode.
   */
  async get(key: string, decode: () => Readable | Promise<Readable>): Promise<EffectPcmResult> {
    const oversizeMs = this.oversize.get(key)
    if (oversizeMs !== undefined) {
      log.debug(`Effect ${basename(key)} is over the cache cut-off; streaming it uncached`)
      return {
        stream: await decode(),
        durationMs: oversizeMs,
      }
    }

    const cached = this.cache.get(key)
    if (cached !== undefined) {
      this.bump(key, cached)
      return {
        stream: NodeReadable.from(Buffer.from(cached)),
        durationMs: durationOf(cached),
      }
    }

    const buffer = await this.decodeOnce(key, decode)
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
   * Rejects when the decode fails, leaving nothing cached.
   */
  async warm(key: string, decode: () => Readable | Promise<Readable>): Promise<void> {
    if (this.oversize.has(key))
      return
    const cached = this.cache.get(key)
    if (cached !== undefined) {
      this.bump(key, cached)
      return
    }
    await this.decodeOnce(key, decode)
  }

  private decodeOnce(key: string, decode: () => Readable | Promise<Readable>): Promise<Buffer> {
    const inFlight = this.pending.get(key)
    if (inFlight)
      return inFlight

    const decoding = (async () => readAll(await decode()))()
      .then((buffer) => {
        if (buffer.length > this.maxEntryBytes)
          this.markOversize(key, buffer)
        else
          this.bump(key, buffer)
        return buffer
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, decoding)
    return decoding
  }

  private markOversize(key: string, buffer: Buffer): void {
    const durationMs = durationOf(buffer)
    log.warn(`Effect ${basename(key)} decodes to ${toMb(buffer.length)} MB (${durationMs} ms), over the ${toMb(this.maxEntryBytes)} MB cache cut-off; streaming it uncached from now on`)
    this.oversize.set(key, durationMs)
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

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
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
