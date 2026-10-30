import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSoundLibrary } from './sound-library'

const FIXTURES_DIR = join(__dirname, '..', 'audio', 'decoders', 'fixtures')

describe('createSoundLibrary', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-sound-'))
  const musicDir = join(tempRoot, 'music')
  const effectsDir = join(tempRoot, 'effects')
  const config = {
    discord: { token: '' },
    audio: {
      storageRoot: tempRoot,
      musicDir,
      effectsDir,
      webDistDir: 'web-dist',
    },
    database: {
      path: join(tempRoot, 'data', 'hibiki.json'),
    },
  }

  beforeAll(async () => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(musicDir, { recursive: true })
    await mkdir(effectsDir, { recursive: true })
  })

  it('list returns empty when no files', async () => {
    const lib = createSoundLibrary(config)
    const list = await lib.list('music')
    expect(list).toEqual([])
  })

  it('list returns files with metadata', async () => {
    writeFileSync(join(musicDir, 'test.mp3'), 'data')
    const lib = createSoundLibrary(config)
    const list = await lib.list('music')
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe('test')
    expect(list[0]!.name).toBe('Test')
    expect(list[0]!.filename).toBe('test.mp3')
    expect(list[0]!.category).toBe('music')
  })

  it('getFilePath returns path for existing file', async () => {
    const lib = createSoundLibrary(config)
    const path = await lib.getFilePath('music', 'test')
    expect(path).toContain('test.mp3')
  })

  it('save writes file and returns metadata', async () => {
    const lib = createSoundLibrary(config)
    const result = await lib.save('music', {
      buffer: Buffer.from('x'),
      originalname: 'my-song.mp3',
    })
    expect(result.id).toBeDefined()
    expect(result.filename).toMatch(/\.mp3$/)
    expect(result.category).toBe('music')
  })

  it('remove deletes file', async () => {
    writeFileSync(join(effectsDir, 'boom.wav'), 'x')
    const lib = createSoundLibrary(config)
    await lib.remove('effects', 'boom')
    const list = await lib.list('effects')
    expect(list).toHaveLength(0)
  })
})

describe('sound tags', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-sound-tags-'))
  const musicDir = join(tempRoot, 'music')
  const ambienceDir = join(tempRoot, 'ambience')
  const config = {
    discord: { token: '' },
    vision: { apiKey: '' },
    audio: {
      storageRoot: tempRoot,
      musicDir,
      effectsDir: join(tempRoot, 'effects'),
      ambienceDir,
      webDistDir: 'web-dist',
    },
    database: {
      path: join(tempRoot, 'data', 'hibiki.json'),
    },
  }

  beforeAll(async () => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(musicDir, { recursive: true })
    await mkdir(ambienceDir, { recursive: true })
    writeFileSync(join(musicDir, 'tavern.mp3'), 'data')
    writeFileSync(join(ambienceDir, 'rain.mp3'), 'data')
  })

  it('tags default to an empty list for untagged sounds', async () => {
    const lib = createSoundLibrary(config)
    const list = await lib.list('music')
    expect(list[0]!.tags).toEqual([])
    const file = await lib.getFile('music', 'tavern')
    expect(file.tags).toEqual([])
  })

  it('setTags persists tags and returns them from list() and getFile()', async () => {
    const lib = createSoundLibrary(config)
    await lib.setTags('music', 'tavern', ['warm', 'Candlelit'])
    const list = await lib.list('music')
    expect(list[0]!.tags).toEqual(['warm', 'Candlelit'])
    const file = await lib.getFile('music', 'tavern')
    expect(file.tags).toEqual(['warm', 'Candlelit'])
  })

  it('setTags normalizes whitespace and drops empty entries', async () => {
    const lib = createSoundLibrary(config)
    const saved = await lib.setTags('ambience', 'rain', ['  storm ', '', 'wet '])
    expect(saved).toEqual(['storm', 'wet'])
  })

  it('setTags rejects unknown sounds', async () => {
    const lib = createSoundLibrary(config)
    await expect(lib.setTags('music', 'nope', ['x'])).rejects.toThrow(/not found/)
  })

  it('tags are scoped per category', async () => {
    const lib = createSoundLibrary(config)
    const ambience = await lib.list('ambience')
    expect(ambience[0]!.tags).toEqual(['storm', 'wet'])
    const music = await lib.list('music')
    expect(music[0]!.tags).toEqual(['warm', 'Candlelit'])
  })

  it('tags survive across separate service instances', async () => {
    const other = createSoundLibrary(config)
    const file = await other.getFile('music', 'tavern')
    expect(file.tags).toEqual(['warm', 'Candlelit'])
  })

  it('save() returns a sound with empty tags', async () => {
    const lib = createSoundLibrary(config)
    const saved = await lib.save('music', {
      buffer: Buffer.from('x'),
      originalname: 'new-song.mp3',
    })
    expect(saved.tags).toEqual([])
  })

  it('remove() clears the tags of the deleted sound', async () => {
    const lib = createSoundLibrary(config)
    writeFileSync(join(ambienceDir, 'wind.mp3'), 'data')
    await lib.setTags('ambience', 'wind', ['howling'])
    await lib.remove('ambience', 'wind')
    writeFileSync(join(ambienceDir, 'wind.mp3'), 'data')
    const file = await lib.getFile('ambience', 'wind')
    expect(file.tags).toEqual([])
  })
})

describe('canDecode', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-sound-decode-'))
  const musicDir = join(tempRoot, 'music')
  const config = {
    discord: { token: '' },
    audio: {
      storageRoot: tempRoot,
      musicDir,
      effectsDir: join(tempRoot, 'effects'),
      webDistDir: 'web-dist',
    },
    database: {
      path: join(tempRoot, 'data', 'hibiki.json'),
    },
  }

  beforeAll(async () => {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(musicDir, { recursive: true })
    copyFileSync(join(FIXTURES_DIR, 'fixture-stereo-44100.mp3'), join(musicDir, 'decodable-song.mp3'))
    copyFileSync(join(FIXTURES_DIR, 'fixture.m4a'), join(musicDir, 'undecodable-song.m4a'))
  })

  it('reports true for a format with a backend decoder', async () => {
    const lib = createSoundLibrary(config)
    await expect(lib.canDecode('music', 'decodable-song')).resolves.toBe(true)
  })

  it('reports false for a format with no backend decoder (renderer fallback)', async () => {
    const lib = createSoundLibrary(config)
    await expect(lib.canDecode('music', 'undecodable-song')).resolves.toBe(false)
  })

  it('rejects for an unknown sound id', async () => {
    const lib = createSoundLibrary(config)
    await expect(lib.canDecode('music', 'does-not-exist')).rejects.toThrow(/not found/)
  })
})

describe('sound library edge cases', () => {
  let tempRoot: string
  let config: {
    discord: { token: string }
    audio: { storageRoot: string, musicDir: string, effectsDir: string, ambienceDir: string, webDistDir: string }
    database: { path: string }
  }

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-sound-edge-'))
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
  })

  afterEach(() => {
    jest.restoreAllMocks()
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('list returns empty for a category whose directory does not exist', async () => {
    await expect(createSoundLibrary(config).list('ambience')).resolves.toEqual([])
  })

  it.each([
    ['music', 'musicDir'],
    ['effects', 'effectsDir'],
    ['ambience', 'ambienceDir'],
  ] as const)('save writes %s into its own directory', async (category, dirKey) => {
    const saved = await createSoundLibrary(config).save(category, {
      buffer: Buffer.from('abc'),
      originalname: 'Dragon Roar!.ogg',
    })
    expect(saved).toMatchObject({ category, size: 3, tags: [] })
    expect(saved.id).toMatch(/^dragon-roar-\d+$/)
    expect(readFileSync(join(config.audio[dirKey], saved.filename), 'utf-8')).toBe('abc')
  })

  it('save defaults a name without an extension to .mp3', async () => {
    const saved = await createSoundLibrary(config).save('music', {
      buffer: Buffer.from('x'),
      originalname: 'no-extension',
    })
    expect(saved.filename).toBe(`${saved.id}.mp3`)
  })

  it('save keeps an unsupported extension, which then has no backend decoder', async () => {
    const lib = createSoundLibrary(config)
    const saved = await lib.save('effects', {
      buffer: Buffer.from('not audio'),
      originalname: 'notes.txt',
    })
    expect(saved.filename).toMatch(/\.txt$/)
    await expect(lib.canDecode('effects', saved.id)).resolves.toBe(false)
  })

  it('save keys each upload by slug and upload time, so a repeated name gets its own file', async () => {
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValueOnce(1000).mockReturnValueOnce(2000)
    const lib = createSoundLibrary(config)
    const a = await lib.save('music', {
      buffer: Buffer.from('a'),
      originalname: 'theme.mp3',
    })
    const b = await lib.save('music', {
      buffer: Buffer.from('b'),
      originalname: 'theme.mp3',
    })
    expect([a.id, b.id]).toEqual(['theme-1000', 'theme-2000'])
    expect((await lib.list('music')).map(f => f.id).sort()).toEqual(['theme-1000', 'theme-2000'])
  })

  it('remove rejects an unknown id', async () => {
    mkdirSync(config.audio.effectsDir, { recursive: true })
    await expect(createSoundLibrary(config).remove('effects', 'ghost')).rejects.toThrow('Sound \'ghost\' not found in effects')
  })

  it('treats glob characters in an id literally', async () => {
    mkdirSync(config.audio.musicDir, { recursive: true })
    writeFileSync(join(config.audio.musicDir, 'battle.mp3'), 'x')
    const lib = createSoundLibrary(config)
    await expect(lib.getFilePath('music', '*')).rejects.toThrow(/not found/)
    writeFileSync(join(config.audio.musicDir, 'boss (phase 2).mp3'), 'x')
    await expect(lib.getFilePath('music', 'boss (phase 2)')).resolves.toBe(join(config.audio.musicDir, 'boss (phase 2).mp3'))
  })

  it('getFile returns metadata and path for an ambience sound', async () => {
    mkdirSync(config.audio.ambienceDir, { recursive: true })
    writeFileSync(join(config.audio.ambienceDir, 'forest_night.ogg'), 'abcd')
    const file = await createSoundLibrary(config).getFile('ambience', 'forest_night')
    expect(file).toMatchObject({
      id: 'forest_night',
      name: 'Forest Night',
      filename: 'forest_night.ogg',
      category: 'ambience',
      size: 4,
      tags: [],
      path: join(config.audio.ambienceDir, 'forest_night.ogg'),
    })
  })

  describe('getFileByIdOrName', () => {
    beforeEach(() => {
      mkdirSync(config.audio.musicDir, { recursive: true })
      writeFileSync(join(config.audio.musicDir, 'tavern-song-123.mp3'), 'x')
    })

    it('finds a sound by id', async () => {
      await expect(createSoundLibrary(config).getFileByIdOrName('music', 'tavern-song-123')).resolves.toMatchObject({ id: 'tavern-song-123' })
    })

    it('falls back to a case-insensitive id match', async () => {
      await expect(createSoundLibrary(config).getFileByIdOrName('music', 'TAVERN-SONG-123')).resolves.toMatchObject({ id: 'tavern-song-123' })
    })

    it('falls back to a case-insensitive partial name match', async () => {
      await expect(createSoundLibrary(config).getFileByIdOrName('music', 'song')).resolves.toMatchObject({ id: 'tavern-song-123' })
    })

    it('rejects when nothing matches', async () => {
      await expect(createSoundLibrary(config).getFileByIdOrName('music', 'dragon')).rejects.toThrow('No music found matching \'dragon\'')
    })
  })
})

describe('sound ids stay inside the library directory', () => {
  let tempRoot: string
  let config: {
    discord: { token: string }
    audio: { storageRoot: string, musicDir: string, effectsDir: string, ambienceDir: string, webDistDir: string }
    database: { path: string }
  }

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-sound-traversal-'))
    config = {
      discord: { token: '' },
      audio: {
        storageRoot: tempRoot,
        musicDir: join(tempRoot, 'storage', 'music'),
        effectsDir: join(tempRoot, 'storage', 'effects'),
        ambienceDir: join(tempRoot, 'storage', 'ambience'),
        webDistDir: 'web-dist',
      },
      database: {
        path: join(tempRoot, 'data', 'hibiki.json'),
      },
    }
    mkdirSync(config.audio.musicDir, { recursive: true })
    mkdirSync(config.audio.ambienceDir, { recursive: true })
    mkdirSync(join(tempRoot, 'data'), { recursive: true })
    writeFileSync(join(tempRoot, 'data', 'app-config.json'), '{"secret":true}')
    writeFileSync(join(tempRoot, 'storage', 'outside.mp3'), 'x')
    writeFileSync(join(config.audio.ambienceDir, 'rain.mp3'), 'x')
  })

  afterEach(() => {
    jest.restoreAllMocks()
    rmSync(tempRoot, { recursive: true, force: true })
  })

  const unsafeIds = [
    '../../data/app-config',
    '../outside',
    'sub/rain',
    '..\\outside',
    '..',
    '.',
    '',
    'with\0nul',
  ]

  it.each(unsafeIds)('getFilePath rejects the id %j', async (id) => {
    await expect(createSoundLibrary(config).getFilePath('music', id)).rejects.toThrow(/Invalid sound id/)
  })

  it('rejects an absolute path as an id', async () => {
    const absolute = join(tempRoot, 'data', 'app-config')
    await expect(createSoundLibrary(config).getFilePath('music', absolute)).rejects.toThrow(/Invalid sound id/)
  })

  it.each(['canDecode', 'getFile', 'remove'] as const)('%s rejects a traversal id', async (method) => {
    await expect(createSoundLibrary(config)[method]('music', '../../data/app-config')).rejects.toThrow(/Invalid sound id/)
  })

  it('setTags rejects a traversal id', async () => {
    await expect(createSoundLibrary(config).setTags('music', '../../data/app-config', ['x'])).rejects.toThrow(/Invalid sound id/)
  })

  it('remove never unlinks a file outside the library', async () => {
    await expect(createSoundLibrary(config).remove('music', '../../data/app-config')).rejects.toThrow()
    expect(readFileSync(join(tempRoot, 'data', 'app-config.json'), 'utf-8')).toBe('{"secret":true}')
  })

  it.each([
    'getFilePath',
    'canDecode',
    'getFile',
    'remove',
  ] as const)('%s rejects an unknown category instead of reading ambience', async (method) => {
    const lib = createSoundLibrary(config)
    await expect(lib[method]('bogus' as never, 'rain')).rejects.toThrow(/Invalid sound category/)
    expect(readFileSync(join(config.audio.ambienceDir, 'rain.mp3'), 'utf-8')).toBe('x')
  })

  it('setTags rejects an unknown category', async () => {
    await expect(createSoundLibrary(config).setTags('bogus' as never, 'rain', [])).rejects.toThrow(/Invalid sound category/)
  })

  it('still resolves ids with spaces, dots and brackets from files dropped into the folder', async () => {
    writeFileSync(join(config.audio.musicDir, 'Tavern Song v1.2 (live).mp3'), 'x')
    await expect(createSoundLibrary(config).getFilePath('music', 'Tavern Song v1.2 (live)'))
      .resolves
      .toBe(join(config.audio.musicDir, 'Tavern Song v1.2 (live).mp3'))
  })

  it('strips only the trailing extension when the stem contains it too (#662)', async () => {
    writeFileSync(join(config.audio.musicDir, 'rain.wav-mix.wav'), 'x')
    const lib = createSoundLibrary(config)
    const [sound] = await lib.list('music')
    expect(sound!.id).toBe('rain.wav-mix')
    expect(sound!.name).toBe('Rain.Wav Mix')
    await expect(lib.getFilePath('music', sound!.id)).resolves.toBe(join(config.audio.musicDir, 'rain.wav-mix.wav'))
  })

  it('resolves an id to its own file, not to a longer name sharing the prefix (#662)', async () => {
    writeFileSync(join(config.audio.musicDir, 'rain.wav-mix.wav'), 'x')
    writeFileSync(join(config.audio.musicDir, 'rain.wav'), 'x')
    const lib = createSoundLibrary(config)
    await expect(lib.getFilePath('music', 'rain')).resolves.toBe(join(config.audio.musicDir, 'rain.wav'))
    await expect(lib.getFilePath('music', 'rain.wav-mix')).resolves.toBe(join(config.audio.musicDir, 'rain.wav-mix.wav'))
  })

  it('warns when a listed file has an id that cannot be resolved back to it (#662)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    writeFileSync(join(config.audio.musicDir, 'no-extension'), 'x')
    const [sound] = await createSoundLibrary(config).list('music')
    expect(sound!.id).toBe('no-extension')
    expect(warn.mock.calls.flat().join(' ')).toMatch(/no-extension.*cannot be resolved/)
  })
})
