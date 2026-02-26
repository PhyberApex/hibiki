import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { importScene } from './scene-import'

describe('importScene', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-import-'))
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

  function createZip(sceneData: object): string {
    const zip = new AdmZip()
    zip.addFile('scene.json', Buffer.from(JSON.stringify(sceneData), 'utf-8'))
    const zipPath = join(tempRoot, `test-${Date.now()}.zip`)
    zip.writeZip(zipPath)
    return zipPath
  }

  it('throws when scene.json is missing from zip', async () => {
    const zip = new AdmZip()
    zip.addFile('readme.txt', Buffer.from('nothing here'))
    const zipPath = join(tempRoot, 'empty.zip')
    zip.writeZip(zipPath)
    await expect(importScene(config, zipPath)).rejects.toThrow('Invalid scene archive: missing scene.json')
  })

  it('throws when scene.json missing name', async () => {
    const zipPath = createZip({})
    await expect(importScene(config, zipPath)).rejects.toThrow('Invalid scene.json: missing name')
  })

  it('imports scene with name and empty arrays', async () => {
    const zipPath = createZip({ name: 'Imported', ambience: [], music: [], effects: [] })
    const scene = await importScene(config, zipPath)
    expect(scene.name).toBe('Imported')
    expect(scene.ambience).toEqual([])
    expect(scene.music).toEqual([])
    expect(scene.effects).toEqual([])
    expect(scene.id).toBeDefined()
  })

  it('appends (imported) when name exists', async () => {
    const zipPath1 = createZip({ name: 'Same Name', ambience: [], music: [], effects: [] })
    const first = await importScene(config, zipPath1)
    expect(first.name).toBe('Same Name')
    const zipPath2 = createZip({ name: 'Same Name', ambience: [], music: [], effects: [] })
    const second = await importScene(config, zipPath2)
    expect(second.name).toBe('Same Name (imported)')
  })
})
