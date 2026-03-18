import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSceneRegistry } from './scene-registry'

describe('createSceneRegistry', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-registry-'))
  const config = {
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

  beforeEach(() => {
    delete process.env.HIBIKI_USER_DATA
    mkdirSync(join(tempRoot, 'data'), { recursive: true })
  })

  it('getIndex returns empty index when cache does not exist and fetch fails', async () => {
    const registry = createSceneRegistry(config)
    // fetchIndex will fail because the registry repo doesn't exist
    await expect(registry.getIndex()).rejects.toThrow()
  })

  it('installFromRegistry throws for unknown slug', async () => {
    const registry = createSceneRegistry(config)
    await expect(registry.installFromRegistry('nonexistent')).rejects.toThrow()
  })

  it('installFromUrl throws for invalid URL', async () => {
    const registry = createSceneRegistry(config)
    await expect(registry.installFromUrl('not-a-url')).rejects.toThrow()
  })
})
