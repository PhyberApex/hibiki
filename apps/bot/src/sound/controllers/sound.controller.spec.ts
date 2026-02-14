import { Test, TestingModule } from '@nestjs/testing';
import { StreamableFile } from '@nestjs/common';
import { SoundController } from './sound.controller';
import { SoundLibraryService } from '../sound.service';
import { SoundFile } from '../sound.types';

describe('SoundController', () => {
  let controller: SoundController;
  let sounds: jest.Mocked<SoundLibraryService>;

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
  ] as SoundFile[];

  beforeEach(async () => {
    sounds = {
      list: jest.fn().mockResolvedValue(mockList),
      getDistinctTags: jest.fn().mockResolvedValue(['ambient']),
      setTags: jest.fn().mockResolvedValue(undefined),
      getStream: jest.fn().mockResolvedValue({
        stream: { destroy: jest.fn() },
        filename: 'track-1.mp3',
      }),
      save: jest.fn().mockResolvedValue(mockList[0]),
      remove: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SoundLibraryService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SoundController],
      providers: [
        { provide: SoundLibraryService, useValue: sounds },
      ],
    }).compile();

    controller = module.get<SoundController>(SoundController);
  });

  it('listMusic returns list from service', async () => {
    const result = await controller.listMusic();
    expect(result).toEqual(mockList);
    expect(sounds.list).toHaveBeenCalledWith('music', undefined);
  });

  it('listMusic with tag passes filter', async () => {
    await controller.listMusic('ambient');
    expect(sounds.list).toHaveBeenCalledWith('music', 'ambient');
  });

  it('listEffects returns list from service', async () => {
    const result = await controller.listEffects();
    expect(result).toEqual(mockList);
    expect(sounds.list).toHaveBeenCalledWith('effects', undefined);
  });

  it('listMusicTags returns distinct tags', async () => {
    const result = await controller.listMusicTags();
    expect(result).toEqual(['ambient']);
    expect(sounds.getDistinctTags).toHaveBeenCalledWith('music');
  });

  it('setMusicTags normalizes and saves tags', async () => {
    const result = await controller.setMusicTags('track-1', {
      tags: ['  TAG1  ', 'tag2', 'TAG1'],
    });
    expect(result.tags).toEqual(['tag1', 'tag2']);
    expect(sounds.setTags).toHaveBeenCalledWith('music', 'track-1', [
      '  TAG1  ',
      'tag2',
      'TAG1',
    ]);
  });

  it('streamMusic returns StreamableFile', async () => {
    const result = await controller.streamMusic('track-1');
    expect(result).toBeInstanceOf(StreamableFile);
    expect(sounds.getStream).toHaveBeenCalledWith('music', 'track-1');
  });

  it('uploadMusic throws when no file', async () => {
    await expect(controller.uploadMusic(undefined)).rejects.toThrow();
    expect(sounds.save).not.toHaveBeenCalled();
  });

  it('deleteMusic calls remove', async () => {
    await controller.deleteMusic('track-1');
    expect(sounds.remove).toHaveBeenCalledWith('music', 'track-1');
  });
});
