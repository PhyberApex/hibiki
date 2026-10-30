import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSceneRegistry, REGISTRY_INDEX_URL, resolveRegistryIndexUrl } from './scene-registry'

describe('createSceneRegistry', () => {
  let tempRoot: string
  let config: {
    discord: { token: string }
    audio: { storageRoot: string, musicDir: string, effectsDir: string, ambienceDir: string, webDistDir: string }
    database: { path: string }
  }

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-registry-'))
    config = {
      discord: { token: '' },
      audio: {
        storageRoot: tempRoot,
        musicDir: join(tempRoot, 'music'),
        effectsDir: join(tempRoot, 'effects'),
        ambienceDir: join(tempRoot, 'ambience'),
        webDistDir: 'web-dist',
      },
      database: {
        path: join(tempRoot, 'data', 'hibiki.json'),
      },
    }
    delete process.env.HIBIKI_USER_DATA
    mkdirSync(join(tempRoot, 'data'), { recursive: true })
  })

  let fetchMock: jest.SpyInstance

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network call'))
  })

  afterEach(() => {
    fetchMock.mockRestore()
    delete process.env.HIBIKI_USER_DATA
    rmSync(tempRoot, { recursive: true, force: true })
  })

  const cachePath = () => join(tempRoot, 'data', 'registry-cache.json')

  function writeCache(data: object, fetchedAt = new Date().toISOString()) {
    writeFileSync(cachePath(), JSON.stringify({ fetchedAt, data }))
  }

  function respondWith(body: unknown, init: { status?: number, statusText?: string } = {}) {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), init))
  }

  const remoteIndex = { version: 1, updatedAt: '', scenes: [] }

  it('getIndex fetches from remote and caches the index when no cache exists', async () => {
    respondWith(remoteIndex)
    await expect(createSceneRegistry(config).getIndex()).resolves.toEqual(remoteIndex)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(cachePath(), 'utf-8')).data).toEqual(remoteIndex)
  })

  it('getIndex returns a cached index without fetching, however old', async () => {
    writeCache({ ...remoteIndex, version: 7 }, '2000-01-01T00:00:00.000Z')
    await expect(createSceneRegistry(config).getIndex()).resolves.toMatchObject({ version: 7 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('getIndex refetches when the cache file is not valid JSON', async () => {
    writeFileSync(cachePath(), '{ broken')
    respondWith(remoteIndex)
    await expect(createSceneRegistry(config).getIndex()).resolves.toEqual(remoteIndex)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fetchIndex serves a fresh cache and refetches a stale one', async () => {
    const registry = createSceneRegistry(config)
    writeCache({ ...remoteIndex, version: 2 })
    await expect(registry.fetchIndex()).resolves.toMatchObject({ version: 2 })
    expect(fetchMock).not.toHaveBeenCalled()

    writeCache({ ...remoteIndex, version: 2 }, new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString())
    respondWith({ ...remoteIndex, version: 3 })
    await expect(registry.fetchIndex()).resolves.toMatchObject({ version: 3 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fetchIndex(true) ignores a fresh cache', async () => {
    writeCache({ ...remoteIndex, version: 2 })
    respondWith({ ...remoteIndex, version: 4 })
    await expect(createSceneRegistry(config).fetchIndex(true)).resolves.toMatchObject({ version: 4 })
  })

  it('fetchIndex throws on a non-OK response and leaves the cache untouched', async () => {
    respondWith({}, { status: 503, statusText: 'Service Unavailable' })
    await expect(createSceneRegistry(config).fetchIndex()).rejects.toThrow('Failed to fetch registry index: 503 Service Unavailable')
    expect(existsSync(cachePath())).toBe(false)
  })

  it('fetchIndex propagates a network failure', async () => {
    await expect(createSceneRegistry(config).fetchIndex()).rejects.toThrow('unexpected network call')
  })

  it('keeps the cache under HIBIKI_USER_DATA when set', async () => {
    const userData = join(tempRoot, 'user-data')
    mkdirSync(join(userData, 'data'), { recursive: true })
    process.env.HIBIKI_USER_DATA = userData
    respondWith(remoteIndex)
    await createSceneRegistry(config).fetchIndex()
    expect(existsSync(join(userData, 'data', 'registry-cache.json'))).toBe(true)
    expect(existsSync(cachePath())).toBe(false)
  })

  it('fetchIndex fetches the default index URL unless given another', async () => {
    respondWith(remoteIndex)
    await createSceneRegistry(config).fetchIndex(true)
    expect(fetchMock).toHaveBeenLastCalledWith(REGISTRY_INDEX_URL, expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
    respondWith(remoteIndex)
    await createSceneRegistry(config, 'http://127.0.0.1:9/index.json').fetchIndex(true)
    expect(fetchMock).toHaveBeenLastCalledWith('http://127.0.0.1:9/index.json', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
  })

  it('ignores a cache fetched from a different index URL', async () => {
    respondWith({ ...remoteIndex, version: 5 })
    await createSceneRegistry(config).fetchIndex()
    respondWith({ ...remoteIndex, version: 6 })
    const other = createSceneRegistry(config, 'http://127.0.0.1:9/index.json')
    await expect(other.getIndex()).resolves.toMatchObject({ version: 6 })
    await expect(other.fetchIndex()).resolves.toMatchObject({ version: 6 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reads a cache without a recorded URL as fetched from the default index', async () => {
    writeCache({ ...remoteIndex, version: 2 })
    await expect(createSceneRegistry(config).getIndex()).resolves.toMatchObject({ version: 2 })
    respondWith({ ...remoteIndex, version: 3 })
    await expect(createSceneRegistry(config, 'http://127.0.0.1:9/index.json').getIndex()).resolves.toMatchObject({ version: 3 })
  })

  it('installFromRegistry throws for unknown slug', async () => {
    writeCache(remoteIndex)
    await expect(createSceneRegistry(config).installFromRegistry('nonexistent')).rejects.toThrow('Scene \'nonexistent\' not found in registry')
  })

  it('installFromRegistry fails without saving when the index cannot be fetched', async () => {
    respondWith({}, { status: 500, statusText: 'Internal Server Error' })
    await expect(createSceneRegistry(config).installFromRegistry('anything')).rejects.toThrow('Failed to fetch registry index: 500')
    const { createSceneStore } = await import('./scene-store')
    await expect(createSceneStore(config).list()).resolves.toEqual([])
  })

  it('installFromRegistry maps every category to reference-only items and dedupes the name', async () => {
    const entry = {
      name: 'Tavern',
      slug: 'tavern',
      description: '',
      author: '',
      version: '1.0.0',
      tags: [],
      category: 'environment',
      audioBundled: false,
      createdAt: '',
      updatedAt: '',
      scene: {
        music: [
          {
            soundName: 'Lute',
            volume: 70,
            loop: true,
            source: { name: 'Lute song' },
          },
        ],
        ambience: [
          {
            soundName: 'Crowd',
            volume: 30,
            enabled: false,
            source: { name: 'Crowd noise' },
          },
        ],
        effects: [
          {
            soundName: 'Mug',
            volume: 90,
            source: { name: 'Mug clink' },
          },
        ],
      },
    }
    writeCache({
      ...remoteIndex,
      scenes: [entry],
    })
    const registry = createSceneRegistry(config)
    const first = await registry.installFromRegistry('tavern')
    expect(first.name).toBe('Tavern')
    expect(first.music).toEqual([
      {
        soundId: 'Lute',
        soundName: 'Lute',
        volume: 70,
        loop: true,
        source: { name: 'Lute song' },
      },
    ])
    expect(first.ambience).toEqual([
      {
        soundId: 'Crowd',
        soundName: 'Crowd',
        volume: 30,
        enabled: false,
        source: { name: 'Crowd noise' },
      },
    ])
    expect(first.effects).toEqual([
      {
        soundId: 'Mug',
        soundName: 'Mug',
        volume: 90,
        source: { name: 'Mug clink' },
      },
    ])
    expect((await registry.installFromRegistry('tavern')).name).toBe('Tavern (imported)')
  })

  it('installFromRegistry drops any hotkey present in the entry', async () => {
    const entry = {
      name: 'Hot',
      slug: 'hot',
      description: '',
      author: '',
      version: '1.0.0',
      tags: [],
      category: 'environment',
      audioBundled: false,
      createdAt: '',
      updatedAt: '',
      hotkey: 'F1',
      scene: {
        music: [],
        ambience: [],
        effects: [
          {
            soundName: 'Boom',
            hotkey: 'F2',
            source: { name: 'x' },
          },
        ],
      },
    }
    const index = {
      version: 1,
      updatedAt: '',
      scenes: [entry],
    }
    writeFileSync(join(tempRoot, 'data', 'registry-cache.json'), JSON.stringify({
      fetchedAt: new Date().toISOString(),
      data: index,
    }))
    const scene = await createSceneRegistry(config).installFromRegistry('hot')
    expect(scene).not.toHaveProperty('hotkey')
    expect(scene.effects[0]).not.toHaveProperty('hotkey')
  })

  it('installFromRegistry keeps the entry\'s Music Mode and normalises an invalid one', async () => {
    const base = {
      description: '',
      author: '',
      version: '1.0.0',
      tags: [],
      category: 'environment',
      audioBundled: false,
      createdAt: '',
      updatedAt: '',
    }
    const index = {
      version: 1,
      updatedAt: '',
      scenes: [
        {
          ...base,
          name: 'Seq',
          slug: 'seq',
          scene: {
            musicMode: 'sequential',
            music: [],
            ambience: [],
            effects: [],
          },
        },
        {
          ...base,
          name: 'Odd',
          slug: 'odd',
          scene: {
            musicMode: 'nope',
            music: [],
            ambience: [],
            effects: [],
          },
        },
      ],
    }
    writeFileSync(join(tempRoot, 'data', 'registry-cache.json'), JSON.stringify({
      fetchedAt: new Date().toISOString(),
      data: index,
    }))
    const registry = createSceneRegistry(config)
    expect((await registry.installFromRegistry('seq')).musicMode).toBe('sequential')
    expect(await registry.installFromRegistry('odd')).not.toHaveProperty('musicMode')
  })

  describe('untrusted index (#652)', () => {
    it('fetchIndex gives up on a stalled connection after the timeout', async () => {
      fetchMock.mockImplementation((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      }))
      await expect(createSceneRegistry(config, REGISTRY_INDEX_URL, { timeoutMs: 20 }).fetchIndex(true))
        .rejects
        .toThrow('Registry index request timed out after 20 ms')
      expect(existsSync(cachePath())).toBe(false)
    })

    it('fetchIndex gives up when the body stalls after the headers arrive', async () => {
      fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => new Response(new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(init.signal!.reason))
        },
      })))
      await expect(createSceneRegistry(config, REGISTRY_INDEX_URL, { timeoutMs: 20 }).fetchIndex(true))
        .rejects
        .toThrow('Registry index request timed out after 20 ms')
    })

    it.each([
      [
        'an object without scenes',
        { version: 1 },
      ],
      [
        'a scenes field that is not a list',
        { version: 1, scenes: 'none' },
      ],
      ['a bare list', []],
    ])('fetchIndex rejects %s without caching it', async (_label, body) => {
      respondWith(body)
      await expect(createSceneRegistry(config).fetchIndex(true)).rejects.toThrow('Registry index is malformed')
      expect(existsSync(cachePath())).toBe(false)
    })

    it('getIndex refetches when the cached index is malformed', async () => {
      writeCache({ version: 1 })
      respondWith(remoteIndex)
      await expect(createSceneRegistry(config).getIndex()).resolves.toEqual(remoteIndex)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('installFromRegistry rejects an entry without item lists, saving nothing', async () => {
      writeCache({
        ...remoteIndex,
        scenes: [
          {
            name: 'Broken',
            slug: 'broken',
            scene: { music: [] },
          },
        ],
      })
      await expect(createSceneRegistry(config).installFromRegistry('broken')).rejects.toThrow('Registry entry \'broken\' is malformed')
      const { createSceneStore } = await import('./scene-store')
      await expect(createSceneStore(config).list()).resolves.toEqual([])
    })

    it('installFromRegistry rejects an entry whose name is not a string', async () => {
      writeCache({
        ...remoteIndex,
        scenes: [
          {
            name: 42,
            slug: 'nameless',
            scene: { music: [], ambience: [], effects: [] },
          },
        ],
      })
      await expect(createSceneRegistry(config).installFromRegistry('nameless')).rejects.toThrow('Registry entry \'nameless\' is malformed')
    })
  })
})

describe('resolveRegistryIndexUrl', () => {
  it('falls back to the default index for an unset or blank override', () => {
    expect(resolveRegistryIndexUrl(undefined)).toBe(REGISTRY_INDEX_URL)
    expect(resolveRegistryIndexUrl('  ')).toBe(REGISTRY_INDEX_URL)
  })

  it('uses a set override, trimmed', () => {
    expect(resolveRegistryIndexUrl(' http://127.0.0.1:4000/index.json ')).toBe('http://127.0.0.1:4000/index.json')
  })
})
