import { ConfigService } from '@nestjs/config'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SoundLibraryService } from './sound.service'

const createTempDir = () => mkdtempSync(join(tmpdir(), 'hibiki-sound-'))

describe('SoundLibraryService', () => {
  let tempRoot: string
  let musicDir: string
  let effectsDir: string
  let service: SoundLibraryService

  beforeEach(async () => {
    tempRoot = createTempDir()
    musicDir = join(tempRoot, 'music')
    effectsDir = join(tempRoot, 'effects')
    const config = {
      get: (key: string, fallback: string) => {
        if (key === 'audio.musicDir') return musicDir
        if (key === 'audio.effectsDir') return effectsDir
        return fallback
      },
    } as unknown as ConfigService

    service = new SoundLibraryService(config)
    await service.onModuleInit()
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('saves and lists music files', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000)
    await service.save('music', {
      buffer: Buffer.from('music-data'),
      originalname: 'Lo-Fi Vibes.mp3',
    } as Express.Multer.File)

    const files = await service.list('music')
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      id: expect.stringContaining('lo-fi-vibes'),
      category: 'music',
      name: expect.stringContaining('Lo Fi Vibes'),
    })
    nowSpy.mockRestore()
  })

  it('removes files by id', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000)
    const saved = await service.save('effects', {
      buffer: Buffer.from('boom'),
      originalname: 'boom.wav',
    } as Express.Multer.File)

    await service.remove('effects', saved.id)

    await expect(service.list('effects')).resolves.toHaveLength(0)
    nowSpy.mockRestore()
  })

  it('finds files created outside the service', async () => {
    const customFile = join(musicDir, 'manual-track.mp3')
    writeFileSync(customFile, 'manual')

    const file = await service.getFile('music', 'manual-track')
    expect(file.path).toBe(customFile)
    expect(file.name).toBe('Manual Track')
  })
})
