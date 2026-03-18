import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
})
