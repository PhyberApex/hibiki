import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSoundLibrary } from './sound-library'

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
    database: { path: join(tempRoot, 'data', 'hibiki.json') },
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
    database: { path: join(tempRoot, 'data', 'hibiki.json') },
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
    const saved = await lib.save('music', { buffer: Buffer.from('x'), originalname: 'new-song.mp3' })
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
