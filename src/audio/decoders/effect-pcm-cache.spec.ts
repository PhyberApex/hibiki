import type { Readable } from 'node:stream'
import { Readable as NodeReadable } from 'node:stream'
import { createEffectPcmCache } from './effect-pcm-cache'

/** 48 kHz stereo signed 16-bit PCM: 192 bytes per millisecond. */
const PCM_BYTES_PER_MS = 192

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

function streamOf(...chunks: string[]): Readable {
  return NodeReadable.from(chunks.map(c => Buffer.from(c)))
}

function pcmChunkOfMs(ms: number): Buffer {
  return Buffer.alloc(ms * PCM_BYTES_PER_MS)
}

describe('effectPcmCache', () => {
  it('decodes on a cache miss and returns the decoded bytes', async () => {
    const cache = createEffectPcmCache()
    const decode = jest.fn().mockReturnValue(streamOf('a', 'b', 'c'))

    const { stream } = await cache.get('/effects/door.mp3', decode)

    expect(decode).toHaveBeenCalledTimes(1)
    expect((await collect(stream)).toString()).toBe('abc')
  })

  it('reports the duration of the decoded PCM, derived from its byte length', async () => {
    const cache = createEffectPcmCache()
    const decode = jest.fn().mockReturnValue(NodeReadable.from([
      pcmChunkOfMs(250),
    ]))

    const { durationMs } = await cache.get('/effects/thunder.mp3', decode)

    expect(durationMs).toBe(250)
  })

  it('reports the same duration on a cache hit as on the original miss', async () => {
    const cache = createEffectPcmCache()
    const decode = jest.fn().mockReturnValue(NodeReadable.from([
      pcmChunkOfMs(400),
    ]))
    await cache.get('door', decode)

    const { durationMs } = await cache.get('door', decode)

    expect(durationMs).toBe(400)
  })

  it('serves a second request for the same key from the cache, without decoding again', async () => {
    const cache = createEffectPcmCache()
    const decode = jest.fn().mockReturnValue(streamOf('a', 'b', 'c'))
    await collect((await cache.get('/effects/door.mp3', decode)).stream)

    const { stream } = await cache.get('/effects/door.mp3', decode)

    expect(decode).toHaveBeenCalledTimes(1)
    expect((await collect(stream)).toString()).toBe('abc')
  })

  it('returns a fresh, independent stream on every call, cached or not', async () => {
    const cache = createEffectPcmCache()
    const decode = jest.fn().mockReturnValue(streamOf('a', 'b'))

    const first = await cache.get('/effects/door.mp3', decode)
    const second = await cache.get('/effects/door.mp3', decode)

    expect(first.stream).not.toBe(second.stream)
    expect((await collect(first.stream)).toString()).toBe('ab')
    expect((await collect(second.stream)).toString()).toBe('ab')
  })

  it('hands out an independent copy of the cached bytes, so mutating one returned stream\'s data never affects another', async () => {
    // Mirrors what the mixer actually does: it mutates the PCM bytes of
    // whatever buffer it's handed (in-place volume scaling) — so each
    // returned stream's underlying buffer must be its own copy, not a view
    // onto the same cached memory two overlapping instances would race on.
    const cache = createEffectPcmCache()
    const decode = jest.fn().mockReturnValue(streamOf('abc'))

    const first = await cache.get('door', decode)
    const firstBuffer = (await collect(first.stream))
    firstBuffer.fill(0) // simulate in-place mutation of the first instance's bytes

    const second = await cache.get('door', decode)
    expect((await collect(second.stream)).toString()).toBe('abc')
  })

  it('dedupes two concurrent misses for the same key into a single decode', async () => {
    const cache = createEffectPcmCache()
    let resolveDecode!: () => void
    const decode = jest.fn().mockImplementation(() => new Promise((resolve) => {
      resolveDecode = () => resolve(streamOf('abc'))
    }))

    const firstCall = cache.get('door', decode)
    const secondCall = cache.get('door', decode)
    resolveDecode()
    const [first, second] = await Promise.all([firstCall, secondCall])

    expect(decode).toHaveBeenCalledTimes(1)
    expect((await collect(first.stream)).toString()).toBe('abc')
    expect((await collect(second.stream)).toString()).toBe('abc')
  })

  it('decodes again for a different key', async () => {
    const cache = createEffectPcmCache()
    const decodeA = jest.fn().mockReturnValue(streamOf('a'))
    const decodeB = jest.fn().mockReturnValue(streamOf('b'))
    await collect((await cache.get('/effects/a.mp3', decodeA)).stream)

    await collect((await cache.get('/effects/b.mp3', decodeB)).stream)

    expect(decodeA).toHaveBeenCalledTimes(1)
    expect(decodeB).toHaveBeenCalledTimes(1)
  })

  it('evicts the least recently used entry once the entry cap is exceeded', async () => {
    const cache = createEffectPcmCache({ maxEntries: 2 })
    const decodeA = jest.fn().mockReturnValue(streamOf('a'))
    const decodeB = jest.fn().mockReturnValue(streamOf('b'))
    const decodeC = jest.fn().mockReturnValue(streamOf('c'))
    await collect((await cache.get('a', decodeA)).stream)
    await collect((await cache.get('b', decodeB)).stream)

    await collect((await cache.get('c', decodeC)).stream)
    await collect((await cache.get('a', decodeA)).stream)

    // 'a' was the least recently used when 'c' was added, so it was evicted
    // and must be decoded again; 'b' and 'c' both stay cached.
    expect(decodeA).toHaveBeenCalledTimes(2)
  })

  it('touching an entry on a cache hit protects it from eviction as the most recently used', async () => {
    const cache = createEffectPcmCache({ maxEntries: 2 })
    const decodeA = jest.fn().mockReturnValue(streamOf('a'))
    const decodeB = jest.fn().mockReturnValue(streamOf('b'))
    const decodeC = jest.fn().mockReturnValue(streamOf('c'))
    await collect((await cache.get('a', decodeA)).stream)
    await collect((await cache.get('b', decodeB)).stream)
    // Touch 'a' again so 'b' becomes the least recently used entry.
    await collect((await cache.get('a', decodeA)).stream)

    await collect((await cache.get('c', decodeC)).stream)
    await collect((await cache.get('b', decodeB)).stream)

    expect(decodeA).toHaveBeenCalledTimes(1)
    expect(decodeB).toHaveBeenCalledTimes(2)
  })

  it('never caches a decode that errors, so the next request decodes again', async () => {
    const cache = createEffectPcmCache()
    let first = true
    const decode = jest.fn().mockImplementation(() => {
      if (first) {
        first = false
        const { PassThrough } = jest.requireActual('node:stream')
        const bad = new PassThrough()
        setImmediate(() => bad.emit('error', new Error('boom')))
        return bad
      }
      return streamOf('ok')
    })

    await expect(cache.get('x', decode)).rejects.toThrow('boom')
    const { stream } = await cache.get('x', decode)

    expect(decode).toHaveBeenCalledTimes(2)
    expect((await collect(stream)).toString()).toBe('ok')
  })

  describe('byte budget and oversize cut-off (#664)', () => {
    let warn: jest.SpyInstance
    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => warn.mockRestore())

    function decoderOfMs(ms: number): jest.Mock {
      return jest.fn().mockImplementation(() => NodeReadable.from([
        pcmChunkOfMs(ms),
      ]))
    }

    it('evicts least recently used entries once the total cached bytes exceed the budget', async () => {
      const cache = createEffectPcmCache({ maxBytes: pcmChunkOfMs(250).length })
      const decodeA = decoderOfMs(100)
      const decodeB = decoderOfMs(100)
      const decodeC = decoderOfMs(100)
      await collect((await cache.get('a', decodeA)).stream)
      await collect((await cache.get('b', decodeB)).stream)

      await collect((await cache.get('c', decodeC)).stream)
      await collect((await cache.get('b', decodeB)).stream)
      await collect((await cache.get('c', decodeC)).stream)
      await collect((await cache.get('a', decodeA)).stream)

      // 300 ms of PCM is over the 250 ms budget, so adding 'c' evicted 'a'.
      expect(decodeA).toHaveBeenCalledTimes(2)
      expect(decodeB).toHaveBeenCalledTimes(1)
      expect(decodeC).toHaveBeenCalledTimes(1)
    })

    it('plays an Effect over the per-file cut-off with its full duration but never retains it, warning with the sound name', async () => {
      const cache = createEffectPcmCache({ maxEntryBytes: pcmChunkOfMs(500).length })
      const decode = decoderOfMs(600)

      const first = await cache.get('/effects/long-battle.mp3', decode)

      expect(first.durationMs).toBe(600)
      expect(await collect(first.stream)).toHaveLength(pcmChunkOfMs(600).length)
      expect(warn).toHaveBeenCalledWith('[effect-pcm-cache]', expect.stringContaining('long-battle.mp3'))

      const second = await cache.get('/effects/long-battle.mp3', decode)
      expect(decode).toHaveBeenCalledTimes(2)
      expect(second.durationMs).toBe(600)
      expect(await collect(second.stream)).toHaveLength(pcmChunkOfMs(600).length)
      expect(warn).toHaveBeenCalledTimes(1)
    })

    it('streams a known-oversize Effect straight from its decoder instead of waiting for the full decode', async () => {
      const cache = createEffectPcmCache({ maxEntryBytes: pcmChunkOfMs(500).length })
      await collect((await cache.get('long', decoderOfMs(600))).stream)

      const { PassThrough } = jest.requireActual('node:stream')
      const live = new PassThrough()
      const result = await cache.get('long', () => live)

      expect(result.stream).toBe(live)
      expect(result.durationMs).toBe(600)
    })

    it('does not let an oversize Effect evict the cached ones', async () => {
      const cache = createEffectPcmCache({
        maxBytes: pcmChunkOfMs(300).length,
        maxEntryBytes: pcmChunkOfMs(200).length,
      })
      const decodeSmall = decoderOfMs(100)
      await collect((await cache.get('small', decodeSmall)).stream)

      await collect((await cache.get('huge', decoderOfMs(1000))).stream)
      await collect((await cache.get('small', decodeSmall)).stream)

      expect(decodeSmall).toHaveBeenCalledTimes(1)
    })
  })
  describe('warm', () => {
    it('decodes an uncached Effect into the cache so the first trigger needs no decode', async () => {
      const cache = createEffectPcmCache()
      const decode = jest.fn().mockReturnValue(streamOf('a', 'b'))

      await cache.warm('/effects/thunder.mp3', decode)
      const { stream } = await cache.get('/effects/thunder.mp3', decode)

      expect(decode).toHaveBeenCalledTimes(1)
      expect((await collect(stream)).toString()).toBe('ab')
    })

    it('does not decode an Effect that is already cached, but refreshes its recency', async () => {
      const cache = createEffectPcmCache({ maxEntries: 2 })
      const decodeA = jest.fn().mockImplementation(() => streamOf('a'))
      const decodeB = jest.fn().mockImplementation(() => streamOf('b'))
      await cache.warm('a', decodeA)
      await cache.warm('b', decodeB)

      await cache.warm('a', decodeA)
      await cache.warm('c', () => streamOf('c'))
      await cache.get('a', decodeA)
      await cache.get('b', decodeB)

      expect(decodeA).toHaveBeenCalledTimes(1)
      expect(decodeB).toHaveBeenCalledTimes(2)
    })

    it('does not decode an Effect already known to be over the cut-off', async () => {
      const cache = createEffectPcmCache({ maxEntryBytes: PCM_BYTES_PER_MS * 100 })
      const decode = jest.fn().mockImplementation(() => NodeReadable.from([
        pcmChunkOfMs(200),
      ]))
      await cache.warm('long', decode)

      await cache.warm('long', decode)

      expect(decode).toHaveBeenCalledTimes(1)
    })

    it('rejects when the decode fails and leaves nothing cached', async () => {
      const cache = createEffectPcmCache()
      const failing = jest.fn().mockRejectedValue(new Error('corrupt'))

      await expect(cache.warm('bad', failing)).rejects.toThrow('corrupt')

      const decode = jest.fn().mockReturnValue(streamOf('ok'))
      await cache.get('bad', decode)
      expect(decode).toHaveBeenCalledTimes(1)
    })

    it('keeps 32 Effects by default, evicting the least recently used beyond that', async () => {
      const cache = createEffectPcmCache()
      const decoders = Array.from({ length: 33 }, (_, i) => jest.fn().mockImplementation(() => streamOf(String(i))))
      for (const [i, decode] of decoders.entries())
        await cache.warm(`fx${i}`, decode)

      await cache.get('fx1', decoders[1]!)
      await cache.get('fx0', decoders[0]!)

      expect(decoders[1]).toHaveBeenCalledTimes(1)
      expect(decoders[0]).toHaveBeenCalledTimes(2)
    })
  })
})
