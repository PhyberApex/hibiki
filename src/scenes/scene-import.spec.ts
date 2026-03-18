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

  function createManifestZip(manifest: object): string {
    const zip = new AdmZip()
    zip.addFile('hibiki-scene.json', Buffer.from(JSON.stringify(manifest), 'utf-8'))
    const zipPath = join(tempRoot, `test-${Date.now()}.zip`)
    zip.writeZip(zipPath)
    return zipPath
  }

  function makeManifest(overrides: Record<string, unknown> = {}) {
    return {
      formatVersion: 1,
      name: 'test-scene',
      displayName: 'Test Scene',
      description: '',
      author: '',
      version: '1.0.0',
      tags: [],
      category: 'environment',
      scene: { music: [], ambience: [], effects: [] },
      ...overrides,
    }
  }

  it('throws when hibiki-scene.json is missing from zip', async () => {
    const zip = new AdmZip()
    zip.addFile('readme.txt', Buffer.from('nothing here'))
    const zipPath = join(tempRoot, 'empty.zip')
    zip.writeZip(zipPath)
    await expect(importScene(config, zipPath)).rejects.toThrow('Invalid scene archive: missing hibiki-scene.json')
  })

  it('throws when manifest is missing scene data', async () => {
    const zipPath = createManifestZip({ formatVersion: 1, name: 'test' })
    await expect(importScene(config, zipPath)).rejects.toThrow('Invalid hibiki-scene.json: missing scene data')
  })

  it('imports scene with displayName and empty arrays', async () => {
    const zipPath = createManifestZip(makeManifest({ displayName: 'Imported' }))
    const scene = await importScene(config, zipPath)
    expect(scene.name).toBe('Imported')
    expect(scene.ambience).toEqual([])
    expect(scene.music).toEqual([])
    expect(scene.effects).toEqual([])
    expect(scene.id).toBeDefined()
  })

  it('appends (imported) when name exists', async () => {
    const zipPath1 = createManifestZip(makeManifest({ displayName: 'Same Name' }))
    const first = await importScene(config, zipPath1)
    expect(first.name).toBe('Same Name')
    const zipPath2 = createManifestZip(makeManifest({ displayName: 'Same Name' }))
    const second = await importScene(config, zipPath2)
    expect(second.name).toBe('Same Name (imported)')
  })

  it('imports scene with reference-only items preserving source', async () => {
    const manifest = makeManifest({
      displayName: 'With Sources',
      scene: {
        music: [{
          soundName: 'Epic Theme',
          volume: 70,
          bundled: false,
          source: { name: 'Some Track', url: 'https://example.com', note: 'Any epic track' },
        }],
        ambience: [],
        effects: [],
      },
    })
    const zipPath = createManifestZip(manifest)
    const scene = await importScene(config, zipPath)
    expect(scene.music).toHaveLength(1)
    expect(scene.music[0]!.soundName).toBe('Epic Theme')
    expect(scene.music[0]!.source).toEqual({ name: 'Some Track', url: 'https://example.com', note: 'Any epic track' })
  })
})
