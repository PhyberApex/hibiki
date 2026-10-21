import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
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

  function createManifestZip(manifest: object, files: Record<string, string> = {}): string {
    const zip = new AdmZip()
    zip.addFile('hibiki-scene.json', Buffer.from(JSON.stringify(manifest), 'utf-8'))
    for (const [entryName, content] of Object.entries(files))
      zip.addFile(entryName, Buffer.from(content))
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

  it('drops any hotkey present in the archive', async () => {
    const pkg = { bundled: false, hotkey: 'F2' }
    const zipPath = createManifestZip(makeManifest({
      displayName: 'Hotkey Import',
      hotkey: 'F1',
      scene: { music: [], ambience: [], effects: [{ ...pkg, soundName: 'Boom' }] },
    }))
    const scene = await importScene(config, zipPath)
    expect(scene).not.toHaveProperty('hotkey')
    expect(scene.effects[0]).not.toHaveProperty('hotkey')
  })

  it('keeps the archive\'s Music Mode; an absent or invalid one reads as single', async () => {
    const shuffled = await importScene(config, createManifestZip(makeManifest({
      displayName: 'Mode Shuffle',
      scene: { musicMode: 'shuffle', music: [], ambience: [], effects: [] },
    })))
    expect(shuffled.musicMode).toBe('shuffle')

    const old = await importScene(config, createManifestZip(makeManifest({ displayName: 'Mode Old' })))
    expect(old).not.toHaveProperty('musicMode')

    const invalid = await importScene(config, createManifestZip(makeManifest({
      displayName: 'Mode Invalid',
      scene: { musicMode: 'loop-forever', music: [], ambience: [], effects: [] },
    })))
    expect(invalid).not.toHaveProperty('musicMode')
  })

  it('throws on a manifest that is not valid JSON', async () => {
    const zip = new AdmZip()
    zip.addFile('hibiki-scene.json', Buffer.from('{ not json', 'utf-8'))
    const zipPath = join(tempRoot, 'malformed.zip')
    zip.writeZip(zipPath)
    await expect(importScene(config, zipPath)).rejects.toThrow(SyntaxError)
  })

  it('falls back to the manifest name, then to a default, when there is no displayName', async () => {
    const byName = await importScene(config, createManifestZip(makeManifest({ displayName: '', name: 'slug-only' })))
    expect(byName.name).toBe('slug-only')
    const unnamed = await importScene(config, createManifestZip(makeManifest({ displayName: '', name: '' })))
    expect(unnamed.name).toBe('Imported scene')
  })

  it('keeps appending (imported) until the name is free, ignoring case', async () => {
    await importScene(config, createManifestZip(makeManifest({ displayName: 'Twice' })))
    await importScene(config, createManifestZip(makeManifest({ displayName: 'twice' })))
    const third = await importScene(config, createManifestZip(makeManifest({ displayName: 'TWICE' })))
    expect(third.name).toBe('TWICE (imported) (imported)')
  })

  it('extracts bundled sounds into each category\'s directory and points items at them', async () => {
    const manifest = makeManifest({
      displayName: 'Bundled',
      scene: {
        music: [{ soundName: 'Theme', volume: 80, loop: true, bundled: true, bundledPath: 'sounds/music/theme-1.mp3' }],
        ambience: [{ soundName: 'Rain', volume: 40, enabled: false, bundled: true, bundledPath: 'sounds/ambience/rain-2.ogg' }],
        effects: [{ soundName: 'Boom', volume: 100, bundled: true, bundledPath: 'sounds/effects/boom-3.wav' }],
      },
    })
    const zipPath = createManifestZip(manifest, {
      'sounds/music/theme-1.mp3': 'music-bytes',
      'sounds/ambience/rain-2.ogg': 'ambience-bytes',
      'sounds/effects/boom-3.wav': 'effect-bytes',
      'sounds/effects/.DS_Store': 'junk',
    })

    const scene = await importScene(config, zipPath)

    expect(readFileSync(join(config.audio.musicDir, 'theme-1.mp3'), 'utf-8')).toBe('music-bytes')
    expect(readFileSync(join(config.audio.ambienceDir, 'rain-2.ogg'), 'utf-8')).toBe('ambience-bytes')
    expect(readFileSync(join(config.audio.effectsDir, 'boom-3.wav'), 'utf-8')).toBe('effect-bytes')
    expect(existsSync(join(config.audio.effectsDir, '.DS_Store'))).toBe(false)
    expect(scene.music).toEqual([{ soundId: 'theme-1', soundName: 'Theme', volume: 80, loop: true }])
    expect(scene.ambience).toEqual([{ soundId: 'rain-2', soundName: 'Rain', volume: 40, enabled: false }])
    expect(scene.effects).toEqual([{ soundId: 'boom-3', soundName: 'Boom', volume: 100 }])
  })

  it('falls back to the sound name when a bundled file is missing from the archive', async () => {
    const manifest = makeManifest({
      displayName: 'Missing Bundle',
      scene: {
        music: [{ soundName: 'Lost Theme', volume: 50, bundled: true, bundledPath: 'sounds/music/lost.mp3' }],
        ambience: [],
        effects: [],
      },
    })
    const scene = await importScene(config, createManifestZip(manifest))
    expect(scene.music[0]!.soundId).toBe('Lost Theme')
  })
})
