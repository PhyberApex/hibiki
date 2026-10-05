import type { Readable } from 'node:stream'
import { Readable as NodeReadable } from 'node:stream'
import { createEffectPcmCache } from './effect-pcm-cache'

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

function streamOf(...chunks: string[]): Readable {
  return NodeReadable.from(chunks.map(c => Buffer.from(c)))
}

describe('effectPcmCache', () => {
  it('decodes on a cache miss and returns the decoded bytes', async () => {
    const cache = createEffectPcmCache()
    const decode = jest.fn().mockReturnValue(streamOf('a', 'b', 'c'))

    const stream = await cache.get('/effects/door.mp3', decode)

    expect(decode).toHaveBeenCalledTimes(1)
    expect((await collect(stream)).toString()).toBe('abc')
  })

  it('serves a second request for the same key from the cache, without decoding again', async () => {
    const cache = createEffectPcmCache()
    const decode = jest.fn().mockReturnValue(streamOf('a', 'b', 'c'))
    await collect(await cache.get('/effects/door.mp3', decode))

    const stream = await cache.get('/effects/door.mp3', decode)

    expect(decode).toHaveBeenCalledTimes(1)
    expect((await collect(stream)).toString()).toBe('abc')
  })

  it('returns a fresh, independent stream on every call, cached or not', async () => {
    const cache = createEffectPcmCache()
    const decode = jest.fn().mockReturnValue(streamOf('a', 'b'))

    const first = await cache.get('/effects/door.mp3', decode)
    const second = await cache.get('/effects/door.mp3', decode)

    expect(first).not.toBe(second)
    expect((await collect(first)).toString()).toBe('ab')
    expect((await collect(second)).toString()).toBe('ab')
  })

  it('hands out an independent copy of the cached bytes, so mutating one returned stream\'s data never affects another', async () => {
    // Mirrors what the mixer actually does: it mutates the PCM bytes of
    // whatever buffer it's handed (in-place volume scaling) — so each
    // returned stream's underlying buffer must be its own copy, not a view
    // onto the same cached memory two overlapping instances would race on.
    const cache = createEffectPcmCache()
    const decode = jest.fn().mockReturnValue(streamOf('abc'))

    const first = await cache.get('door', decode)
    const firstBuffer = (await collect(first))
    firstBuffer.fill(0) // simulate in-place mutation of the first instance's bytes

    const second = await cache.get('door', decode)
    expect((await collect(second)).toString()).toBe('abc')
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
    expect((await collect(first)).toString()).toBe('abc')
    expect((await collect(second)).toString()).toBe('abc')
  })

  it('decodes again for a different key', async () => {
    const cache = createEffectPcmCache()
    const decodeA = jest.fn().mockReturnValue(streamOf('a'))
    const decodeB = jest.fn().mockReturnValue(streamOf('b'))
    await collect(await cache.get('/effects/a.mp3', decodeA))

    await collect(await cache.get('/effects/b.mp3', decodeB))

    expect(decodeA).toHaveBeenCalledTimes(1)
    expect(decodeB).toHaveBeenCalledTimes(1)
  })

  it('evicts the least recently used entry once the entry cap is exceeded', async () => {
    const cache = createEffectPcmCache(2)
    const decodeA = jest.fn().mockReturnValue(streamOf('a'))
    const decodeB = jest.fn().mockReturnValue(streamOf('b'))
    const decodeC = jest.fn().mockReturnValue(streamOf('c'))
    await collect(await cache.get('a', decodeA))
    await collect(await cache.get('b', decodeB))

    await collect(await cache.get('c', decodeC))
    await collect(await cache.get('a', decodeA))

    // 'a' was the least recently used when 'c' was added, so it was evicted
    // and must be decoded again; 'b' and 'c' both stay cached.
    expect(decodeA).toHaveBeenCalledTimes(2)
  })

  it('touching an entry on a cache hit protects it from eviction as the most recently used', async () => {
    const cache = createEffectPcmCache(2)
    const decodeA = jest.fn().mockReturnValue(streamOf('a'))
    const decodeB = jest.fn().mockReturnValue(streamOf('b'))
    const decodeC = jest.fn().mockReturnValue(streamOf('c'))
    await collect(await cache.get('a', decodeA))
    await collect(await cache.get('b', decodeB))
    // Touch 'a' again so 'b' becomes the least recently used entry.
    await collect(await cache.get('a', decodeA))

    await collect(await cache.get('c', decodeC))
    await collect(await cache.get('b', decodeB))

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
    const stream = await cache.get('x', decode)

    expect(decode).toHaveBeenCalledTimes(2)
    expect((await collect(stream)).toString()).toBe('ok')
  })
})
