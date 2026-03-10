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
