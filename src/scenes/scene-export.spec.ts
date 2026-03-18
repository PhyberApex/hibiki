import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { exportScene } from './scene-export'

describe('exportScene', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-export-'))
  const musicDir = join(tempRoot, 'music')
  const effectsDir = join(tempRoot, 'effects')
  const ambienceDir = join(tempRoot, 'ambience')
  const config = {
    discord: { token: '' },
    audio: {
      storageRoot: tempRoot,
      musicDir,
      effectsDir,
      ambienceDir,
      webDistDir: 'web-dist',
    },
    database: { path: join(tempRoot, 'data', 'hibiki.json') },
  }

  beforeEach(() => {
    delete process.env.HIBIKI_USER_DATA
    mkdirSync(join(tempRoot, 'data'), { recursive: true })
    mkdirSync(musicDir, { recursive: true })
    mkdirSync(effectsDir, { recursive: true })
    mkdirSync(ambienceDir, { recursive: true })
  })

  it('throws when scene not found', async () => {
    const targetZip = join(tempRoot, 'missing.zip')
    await expect(exportScene(config, 'nonexistent', targetZip)).rejects.toThrow(
      'Scene \'nonexistent\' not found',
    )
  })

  it('exports a zip containing hibiki-scene.json and skips missing sounds', async () => {
    const { createSceneStore } = await import('./scene-store')
    const store = createSceneStore(config)
    const saved = await store.save({
      name: 'Export Test',
      ambience: [{ soundId: 'missing-ambience' }],
      music: [],
      effects: [],
    })
    const targetZip = join(tempRoot, 'export-out.zip')
    await exportScene(config, saved.id, targetZip)

    const zip = new AdmZip(targetZip)
    const manifestEntry = zip.getEntry('hibiki-scene.json')
    expect(manifestEntry).toBeDefined()
    const data = JSON.parse(manifestEntry!.getData().toString('utf-8'))
    expect(data.formatVersion).toBe(1)
    expect(data.displayName).toBe('Export Test')
    expect(data.scene).toBeDefined()
    expect(data.scene.ambience).toHaveLength(1)
    expect(data.scene.ambience[0].bundled).toBe(false)
  })
})
