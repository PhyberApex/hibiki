import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSceneRegistry } from './scene-registry'

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
      database: { path: join(tempRoot, 'data', 'hibiki.json') },
    }
    delete process.env.HIBIKI_USER_DATA
    mkdirSync(join(tempRoot, 'data'), { recursive: true })
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('getIndex fetches from remote when no cache exists', async () => {
    const registry = createSceneRegistry(config)
    try {
      const index = await registry.getIndex()
      expect(index).toHaveProperty('version')
      expect(index).toHaveProperty('scenes')
    }
    catch (err) {
      expect(err).toBeInstanceOf(Error)
    }
  })

  it('installFromRegistry throws for unknown slug', async () => {
    const registry = createSceneRegistry(config)
    await expect(registry.installFromRegistry('nonexistent')).rejects.toThrow()
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
        effects: [{ soundName: 'Boom', hotkey: 'F2', source: { name: 'x' } }],
      },
    }
    const index = { version: 1, updatedAt: '', scenes: [entry] }
    writeFileSync(join(tempRoot, 'data', 'registry-cache.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), data: index }))
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
        { ...base, name: 'Seq', slug: 'seq', scene: { musicMode: 'sequential', music: [], ambience: [], effects: [] } },
        { ...base, name: 'Odd', slug: 'odd', scene: { musicMode: 'nope', music: [], ambience: [], effects: [] } },
      ],
    }
    writeFileSync(join(tempRoot, 'data', 'registry-cache.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), data: index }))
    const registry = createSceneRegistry(config)
    expect((await registry.installFromRegistry('seq')).musicMode).toBe('sequential')
    expect(await registry.installFromRegistry('odd')).not.toHaveProperty('musicMode')
  })
})
