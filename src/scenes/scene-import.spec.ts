import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { createSoundLibrary } from '../sound/sound-library'
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
    database: {
      path: join(tempRoot, 'data', 'hibiki.json'),
    },
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
        music: [
          {
            soundName: 'Epic Theme',
            volume: 70,
            bundled: false,
            source: { name: 'Some Track', url: 'https://example.com', note: 'Any epic track' },
          },
        ],
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

  it('keeps an Ambience item\'s repeat interval (#708)', async () => {
    const zipPath = createManifestZip(makeManifest({
      displayName: 'Storm',
      scene: {
        music: [],
        ambience: [
          {
            soundName: 'thunder',
            volume: 70,
            bundled: false,
            repeatMin: 20,
            repeatMax: 90,
          },
          { soundName: 'rain', bundled: false },
        ],
        effects: [],
      },
    }))
    const scene = await importScene(config, zipPath)
    expect(scene.ambience[0]).toMatchObject({ soundName: 'thunder', repeatMin: 20, repeatMax: 90 })
    expect(scene.ambience[1]).not.toHaveProperty('repeatMin')
    expect(scene.ambience[1]).not.toHaveProperty('repeatMax')
  })

  it('drops any hotkey present in the archive', async () => {
    const pkg = { bundled: false, hotkey: 'F2' }
    const zipPath = createManifestZip(makeManifest({
      displayName: 'Hotkey Import',
      hotkey: 'F1',
      scene: {
        music: [],
        ambience: [],
        effects: [
          { ...pkg, soundName: 'Boom' },
        ],
      },
    }))
    const scene = await importScene(config, zipPath)
    expect(scene).not.toHaveProperty('hotkey')
    expect(scene.effects[0]).not.toHaveProperty('hotkey')
  })

  it('keeps the archive\'s Music Mode; an absent or invalid one reads as single', async () => {
    const shuffled = await importScene(config, createManifestZip(makeManifest({
      displayName: 'Mode Shuffle',
      scene: {
        musicMode: 'shuffle',
        music: [],
        ambience: [],
        effects: [],
      },
    })))
    expect(shuffled.musicMode).toBe('shuffle')

    const old = await importScene(config, createManifestZip(makeManifest({ displayName: 'Mode Old' })))
    expect(old).not.toHaveProperty('musicMode')

    const invalid = await importScene(config, createManifestZip(makeManifest({
      displayName: 'Mode Invalid',
      scene: {
        musicMode: 'loop-forever',
        music: [],
        ambience: [],
        effects: [],
      },
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
        music: [
          {
            soundName: 'Theme',
            volume: 80,
            loop: true,
            bundled: true,
            bundledPath: 'sounds/music/theme-1.mp3',
          },
        ],
        ambience: [
          {
            soundName: 'Rain',
            volume: 40,
            enabled: false,
            bundled: true,
            bundledPath: 'sounds/ambience/rain-2.ogg',
          },
        ],
        effects: [
          {
            soundName: 'Boom',
            volume: 100,
            bundled: true,
            bundledPath: 'sounds/effects/boom-3.wav',
          },
        ],
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
    expect(scene.music).toEqual([
      {
        soundId: 'theme-1',
        soundName: 'Theme',
        volume: 80,
        loop: true,
      },
    ])
    expect(scene.ambience).toEqual([
      {
        soundId: 'rain-2',
        soundName: 'Rain',
        volume: 40,
        enabled: false,
      },
    ])
    expect(scene.effects).toEqual([
      { soundId: 'boom-3', soundName: 'Boom', volume: 100 },
    ])
  })

  it('logs when the import starts, with the bundled files and bytes, and how long it took (#710)', async () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {})
    try {
      const zipPath = createManifestZip(makeManifest({ displayName: 'Logged Import' }), {
        'sounds/music/logged-theme.mp3': 'twelve-bytes',
        'sounds/effects/logged-boom.wav': 'six-by',
      })
      await importScene(config, zipPath)

      const lines = info.mock.calls.map(args => args.join(' '))
      expect(lines).toContainEqual(expect.stringMatching(/^\[scene-import\] Import started \(2 bundled file\(s\) to write, 18 bytes; 0 reused\)$/))
      expect(lines).toContainEqual(expect.stringMatching(/^\[scene-import\] Import finished in \d+ ms: "Logged Import"/))
    }
    finally {
      info.mockRestore()
    }
  })

  it('falls back to the sound name when a bundled file is missing from the archive', async () => {
    const manifest = makeManifest({
      displayName: 'Missing Bundle',
      scene: {
        music: [
          {
            soundName: 'Lost Theme',
            volume: 50,
            bundled: true,
            bundledPath: 'sounds/music/lost.mp3',
          },
        ],
        ambience: [],
        effects: [],
      },
    })
    const scene = await importScene(config, createManifestZip(manifest))
    expect(scene.music[0]!.soundId).toBe('Lost Theme')
  })

  it.each([
    '../../data/app-config',
    'sub/theme',
    '..',
  ])('rejects a reference item whose sound name %j is not a single path segment', async (soundName) => {
    const manifest = makeManifest({
      displayName: `Traversal ${soundName}`,
      scene: {
        music: [
          { soundName, volume: 50, bundled: false },
        ],
        ambience: [],
        effects: [],
      },
    })
    await expect(importScene(config, createManifestZip(manifest))).rejects.toThrow(/not a valid sound id/)
  })

  it('writes no bundled sound and saves no Scene when an item is rejected', async () => {
    const manifest = makeManifest({
      displayName: 'Half Bad',
      scene: {
        music: [
          {
            soundName: 'Theme',
            volume: 50,
            bundled: true,
            bundledPath: 'sounds/music/half-bad-theme.mp3',
          },
        ],
        ambience: [],
        effects: [
          { soundName: '../escape', volume: 50, bundled: false },
        ],
      },
    })
    const zipPath = createManifestZip(manifest, { 'sounds/music/half-bad-theme.mp3': 'x' })
    await expect(importScene(config, zipPath)).rejects.toThrow(/not a valid sound id/)
    expect(existsSync(join(config.audio.musicDir, 'half-bad-theme.mp3'))).toBe(false)
    const { createSceneStore } = await import('./scene-store')
    expect((await createSceneStore(config).list()).some(s => s.name === 'Half Bad')).toBe(false)
  })

  it('never reuses an id from the archive, so an existing scene with that id survives', async () => {
    const existing = await importScene(config, createManifestZip(makeManifest({ displayName: 'Original' })))
    const clash = await importScene(config, createManifestZip(makeManifest({
      displayName: 'Clash',
      scene: {
        id: existing.id,
        music: [],
        ambience: [],
        effects: [],
      },
    })))
    expect(clash.id).not.toBe(existing.id)
    const { createSceneStore } = await import('./scene-store')
    expect((await createSceneStore(config).get(existing.id))?.name).toBe('Original')
  })

  it('treats a blank displayName as absent', async () => {
    const scene = await importScene(config, createManifestZip(makeManifest({ displayName: '   ', name: 'blank-display' })))
    expect(scene.name).toBe('blank-display')
  })

  it('still imports when a stored Scene has a non-string name', async () => {
    const scenesPath = join(tempRoot, 'data', 'scenes.json')
    const stored = JSON.parse(readFileSync(scenesPath, 'utf-8')) as object[]
    writeFileSync(scenesPath, JSON.stringify([
      ...stored,
      {
        id: 'corrupt',
        name: 7,
        music: [],
        ambience: [],
        effects: [],
      },
    ]))
    const scene = await importScene(config, createManifestZip(makeManifest({ displayName: 'After Corrupt' })))
    expect(scene.name).toBe('After Corrupt')
  })

  describe('manifest validation (#652)', () => {
    const item = (overrides: Record<string, unknown> = {}) => ({
      soundName: 'Theme',
      volume: 50,
      bundled: false,
      ...overrides,
    })
    const withMusic = (music: unknown[]) => makeManifest({
      displayName: 'Validated',
      scene: { music, ambience: [], effects: [] },
    })

    it.each([
      [
        'an unknown formatVersion',
        makeManifest({ formatVersion: 2 }),
        'unsupported formatVersion 2',
      ],
      [
        'a non-string displayName',
        makeManifest({ displayName: 42 }),
        'displayName must be a string',
      ],
      [
        'a non-string name',
        makeManifest({
          displayName: '',
          name: { en: 'x' },
        }),
        'name must be a string',
      ],
      [
        'a missing item list',
        makeManifest({
          scene: { music: [], ambience: [] },
        }),
        'scene.effects must be a list',
      ],
      [
        'an item that is not an object',
        withMusic(['Theme']),
        'music item 1 must be an object',
      ],
      [
        'a missing soundName',
        withMusic([
          item({ soundName: undefined }),
        ]),
        'music item 1 has no soundName',
      ],
      [
        'a non-numeric volume',
        withMusic([
          item({ volume: 'loud' }),
        ]),
        'music item 1 volume must be a number from 0 to 100',
      ],
      [
        'an out-of-range volume',
        withMusic([
          item({ volume: 150 }),
        ]),
        'music item 1 volume must be a number from 0 to 100',
      ],
      [
        'a non-boolean enabled',
        withMusic([
          item({ enabled: 'yes' }),
        ]),
        'music item 1 enabled must be true or false',
      ],
      [
        'a non-boolean loop',
        withMusic([
          item({ loop: 1 }),
        ]),
        'music item 1 loop must be true or false',
      ],
      [
        'a source that is not an object with a name',
        withMusic([
          item({ source: 123 }),
        ]),
        'music item 1 source must have a name',
      ],
      [
        'a negative repeatMin',
        withMusic([
          item({ repeatMin: -1 }),
        ]),
        'music item 1 repeatMin must be a number of seconds from 0',
      ],
      [
        'a non-numeric repeatMin',
        withMusic([
          item({ repeatMin: 'often' }),
        ]),
        'music item 1 repeatMin must be a number of seconds from 0',
      ],
      [
        'a non-numeric repeatMax',
        withMusic([
          item({ repeatMax: 'often' }),
        ]),
        'music item 1 repeatMax must be a number of seconds from 0',
      ],
      [
        'a repeatMax below repeatMin',
        withMusic([
          item({ repeatMin: 90, repeatMax: 20 }),
        ]),
        'music item 1 repeatMax must not be less than repeatMin',
      ],
    ])('rejects %s before extracting anything', async (_label, manifest, message) => {
      const zipPath = createManifestZip(manifest, { 'sounds/music/validation-orphan.mp3': 'x' })
      await expect(importScene(config, zipPath)).rejects.toThrow(`Invalid hibiki-scene.json: ${message}`)
      expect(existsSync(join(config.audio.musicDir, 'validation-orphan.mp3'))).toBe(false)
    })
  })

  describe('bundled sound extraction (#652)', () => {
    const bundledManifest = (displayName: string, bundledPath: string) => makeManifest({
      displayName,
      scene: {
        music: [
          {
            soundName: 'Theme',
            volume: 50,
            bundled: true,
            bundledPath,
          },
        ],
        ambience: [],
        effects: [],
      },
    })

    it('rejects an entry larger than the per-file cap without writing anything', async () => {
      const zipPath = createManifestZip(bundledManifest('Too Big', 'sounds/music/too-big.mp3'), {
        'sounds/music/too-big.mp3': 'x'.repeat(64),
      })
      await expect(importScene(config, zipPath, { maxFileBytes: 32, maxTotalBytes: 1024 }))
        .rejects
        .toThrow(/too-big\.mp3 .*exceeds the 32-byte limit/)
      expect(existsSync(join(config.audio.musicDir, 'too-big.mp3'))).toBe(false)
    })

    it('rejects an archive whose bundled sounds together exceed the total cap', async () => {
      const zipPath = createManifestZip(bundledManifest('Too Many', 'sounds/music/many-1.mp3'), {
        'sounds/music/many-1.mp3': 'x'.repeat(30),
        'sounds/effects/many-2.wav': 'x'.repeat(30),
      })
      await expect(importScene(config, zipPath, { maxFileBytes: 32, maxTotalBytes: 50 }))
        .rejects
        .toThrow(/exceed the 50-byte limit/)
      expect(existsSync(join(config.audio.musicDir, 'many-1.mp3'))).toBe(false)
      expect(existsSync(join(config.audio.effectsDir, 'many-2.wav'))).toBe(false)
    })

    it('removes the extracted sounds again when the Scene cannot be saved', async () => {
      const userData = mkdtempSync(join(tmpdir(), 'hibiki-import-unsaved-'))
      // scenes.json reads as empty, but its atomic write cannot replace a non-empty directory
      mkdirSync(join(userData, 'data', 'scenes.json.tmp', 'blocker'), { recursive: true })
      process.env.HIBIKI_USER_DATA = userData
      const zipPath = createManifestZip(bundledManifest('Unsaved', 'sounds/music/unsaved-1.mp3'), {
        'sounds/music/unsaved-1.mp3': 'x',
      })
      await expect(importScene(config, zipPath)).rejects.toThrow(/EISDIR|EPERM|ENOTEMPTY/)
      expect(existsSync(join(config.audio.musicDir, 'unsaved-1.mp3'))).toBe(false)
      delete process.env.HIBIKI_USER_DATA
    })

    it('reuses an existing library file of the same name and size', async () => {
      mkdirSync(config.audio.musicDir, { recursive: true })
      writeFileSync(join(config.audio.musicDir, 'same-1.mp3'), 'abc')
      const zipPath = createManifestZip(bundledManifest('Same File', 'sounds/music/same-1.mp3'), {
        'sounds/music/same-1.mp3': 'xyz',
      })
      const scene = await importScene(config, zipPath)
      expect(scene.music[0]!.soundId).toBe('same-1')
      expect(readFileSync(join(config.audio.musicDir, 'same-1.mp3'), 'utf-8')).toBe('abc')
    })

    it('never overwrites a library file of the same name but different size; the bundled one gets a fresh id', async () => {
      mkdirSync(config.audio.musicDir, { recursive: true })
      writeFileSync(join(config.audio.musicDir, 'rain-1712345.mp3'), 'the GM\'s own rain')
      const zipPath = createManifestZip(bundledManifest('Clash File', 'sounds/music/rain-1712345.mp3'), {
        'sounds/music/rain-1712345.mp3': 'archive rain',
      })
      const scene = await importScene(config, zipPath)
      expect(readFileSync(join(config.audio.musicDir, 'rain-1712345.mp3'), 'utf-8')).toBe('the GM\'s own rain')
      const soundId = scene.music[0]!.soundId
      expect(soundId).toMatch(/^rain-1712345-\d+$/)
      expect(readFileSync(join(config.audio.musicDir, `${soundId}.mp3`), 'utf-8')).toBe('archive rain')
    })

    it('gives a bundled file a fresh id when its name differs from a library file only in case', async () => {
      mkdirSync(config.audio.musicDir, { recursive: true })
      writeFileSync(join(config.audio.musicDir, 'Storm-1.mp3'), 'the GM\'s own storm')
      const zipPath = createManifestZip(bundledManifest('Clash Case', 'sounds/music/storm-1.mp3'), {
        'sounds/music/storm-1.mp3': 'archive storm',
      })
      const scene = await importScene(config, zipPath)
      const soundId = scene.music[0]!.soundId
      expect(soundId).toMatch(/^storm-1-\d+$/)
      expect(readFileSync(join(config.audio.musicDir, 'Storm-1.mp3'), 'utf-8')).toBe('the GM\'s own storm')
      expect(readFileSync(join(config.audio.musicDir, `${soundId}.mp3`), 'utf-8')).toBe('archive storm')
    })

    it('gives a bundled file a fresh id when a library file has the same id under another extension', async () => {
      mkdirSync(config.audio.musicDir, { recursive: true })
      writeFileSync(join(config.audio.musicDir, 'foo-1.mp3'), 'mp3')
      const zipPath = createManifestZip(bundledManifest('Clash Ext', 'sounds/music/foo-1.ogg'), {
        'sounds/music/foo-1.ogg': 'ogg',
      })
      const scene = await importScene(config, zipPath)
      const soundId = scene.music[0]!.soundId
      expect(soundId).not.toBe('foo-1')
      const ids = readdirSync(config.audio.musicDir).filter(f => f.startsWith('foo-1')).map(f => f.replace(/\.[^.]+$/, ''))
      expect(new Set(ids).size).toBe(ids.length)
      expect(readFileSync(join(config.audio.musicDir, `${soundId}.ogg`), 'utf-8')).toBe('ogg')
    })

    it('strips only the trailing extension when the stem contains it too (#662)', async () => {
      const zipPath = createManifestZip(bundledManifest('Ext In Stem', 'sounds/music/drizzle.wav-mix.wav'), {
        'sounds/music/drizzle.wav-mix.wav': 'drizzle',
      })
      const scene = await importScene(config, zipPath)
      const soundId = scene.music[0]!.soundId
      expect(soundId).toBe('drizzle.wav-mix')
      await expect(createSoundLibrary(config).getFilePath('music', soundId))
        .resolves
        .toBe(join(config.audio.musicDir, 'drizzle.wav-mix.wav'))
    })

    it('sees a library file whose stem contains its extension as taken (#662)', async () => {
      mkdirSync(config.audio.musicDir, { recursive: true })
      writeFileSync(join(config.audio.musicDir, 'hail.mp3-mix.mp3'), 'the GM\'s own hail')
      const zipPath = createManifestZip(bundledManifest('Ext In Stem Clash', 'sounds/music/hail.mp3-mix.ogg'), {
        'sounds/music/hail.mp3-mix.ogg': 'archive hail',
      })
      const scene = await importScene(config, zipPath)
      expect(scene.music[0]!.soundId).toMatch(/^hailmp3-mix-\d+$/)
    })
  })
})
