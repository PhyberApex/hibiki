import type { TestingModule } from '@nestjs/testing'
import type { SoundFile } from '../sound.types'
import { StreamableFile } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { SoundLibraryService } from '../sound.service'
import { SoundController } from './sound.controller'

describe('soundController', () => {
  let controller: SoundController
  let sounds: jest.Mocked<SoundLibraryService>

  const mockList = [
    {
      id: 'track-1',
      name: 'Track 1',
      filename: 'track-1.mp3',
      size: 100,
      category: 'music',
      createdAt: '2024-01-01T00:00:00.000Z',
      tags: ['ambient'],
    },
  ] as SoundFile[]

  beforeEach(async () => {
    sounds = {
      list: jest.fn().mockResolvedValue(mockList),
      getDistinctTags: jest.fn().mockResolvedValue(['ambient']),
      setTags: jest.fn().mockResolvedValue(undefined),
      setDisplayName: jest.fn().mockResolvedValue('Custom Name'),
      getStream: jest.fn().mockResolvedValue({
        stream: { destroy: jest.fn() },
        filename: 'track-1.mp3',
      }),
      save: jest.fn().mockResolvedValue(mockList[0]),
      remove: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SoundLibraryService>

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SoundController],
      providers: [
        { provide: SoundLibraryService, useValue: sounds },
      ],
    }).compile()

    controller = module.get<SoundController>(SoundController)
  })

  it('listMusic returns list from service', async () => {
    const result = await controller.listMusic()
    expect(result).toEqual(mockList)
    expect(sounds.list).toHaveBeenCalledWith('music', undefined)
  })

  it('listMusic with tag passes filter', async () => {
    await controller.listMusic('ambient')
    expect(sounds.list).toHaveBeenCalledWith('music', 'ambient')
  })

  it('listEffects returns list from service', async () => {
    const result = await controller.listEffects()
    expect(result).toEqual(mockList)
    expect(sounds.list).toHaveBeenCalledWith('effects', undefined)
  })

  it('listMusicTags returns distinct tags', async () => {
    const result = await controller.listMusicTags()
    expect(result).toEqual(['ambient'])
    expect(sounds.getDistinctTags).toHaveBeenCalledWith('music')
  })

  it('setMusicTags normalizes and saves tags', async () => {
    const result = await controller.setMusicTags('track-1', {
      tags: ['  TAG1  ', 'tag2', 'TAG1'],
    })
    expect(result.tags).toEqual(['tag1', 'tag2'])
    expect(sounds.setTags).toHaveBeenCalledWith('music', 'track-1', [
      '  TAG1  ',
      'tag2',
      'TAG1',
    ])
  })

  it('streamMusic returns StreamableFile', async () => {
    const result = await controller.streamMusic('track-1')
    expect(result).toBeInstanceOf(StreamableFile)
    expect(sounds.getStream).toHaveBeenCalledWith('music', 'track-1')
  })

  it('uploadMusic throws when no file', async () => {
    await expect(controller.uploadMusic(undefined)).rejects.toThrow()
    expect(sounds.save).not.toHaveBeenCalled()
  })

  it('deleteMusic calls remove', async () => {
    await controller.deleteMusic('track-1')
    expect(sounds.remove).toHaveBeenCalledWith('music', 'track-1')
  })

  it('listEffectsTags returns distinct tags for effects', async () => {
    sounds.getDistinctTags.mockResolvedValue(['sfx', 'boom'])
    const result = await controller.listEffectsTags()
    expect(result).toEqual(['sfx', 'boom'])
    expect(sounds.getDistinctTags).toHaveBeenCalledWith('effects')
  })

  it('setEffectsTags normalizes and saves tags', async () => {
    sounds.setTags.mockResolvedValue(undefined)
    const result = await controller.setEffectsTags('effect-1', {
      tags: ['  SFX  ', 'boom', 'SFX'],
    })
    expect(result.tags).toEqual(['sfx', 'boom'])
    expect(sounds.setTags).toHaveBeenCalledWith('effects', 'effect-1', [
      '  SFX  ',
      'boom',
      'SFX',
    ])
  })

  it('streamEffect returns StreamableFile', async () => {
    sounds.getStream.mockResolvedValue({
      stream: { destroy: jest.fn() },
      filename: 'boom.wav',
    })
    const result = await controller.streamEffect('effect-1')
    expect(result).toBeInstanceOf(StreamableFile)
    expect(sounds.getStream).toHaveBeenCalledWith('effects', 'effect-1')
  })

  it('uploadEffect throws when no file', async () => {
    await expect(controller.uploadEffect(undefined)).rejects.toThrow()
    expect(sounds.save).not.toHaveBeenCalled()
  })

  it('deleteEffect calls remove', async () => {
    await controller.deleteEffect('effect-1')
    expect(sounds.remove).toHaveBeenCalledWith('effects', 'effect-1')
  })

  it('setMusicName calls setDisplayName and returns effective name', async () => {
    sounds.setDisplayName!.mockResolvedValue('My Song')
    const result = await controller.setMusicName('track-1', { name: '  My Song  ' })
    expect(result).toEqual({ name: 'My Song' })
    expect(sounds.setDisplayName).toHaveBeenCalledWith('music', 'track-1', '  My Song  ')
  })

  it('setEffectName calls setDisplayName and returns effective name', async () => {
    sounds.setDisplayName!.mockResolvedValue('Boom')
    const result = await controller.setEffectName('effect-1', { name: 'Boom' })
    expect(result).toEqual({ name: 'Boom' })
    expect(sounds.setDisplayName).toHaveBeenCalledWith('effects', 'effect-1', 'Boom')
  })
})
