import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SoundTagService } from './sound-tag.service';
import { SoundTag } from './sound-tag.entity';

describe('SoundTagService', () => {
  let service: SoundTagService;
  let repo: jest.Mocked<Pick<Repository<SoundTag>, 'find' | 'delete' | 'insert' | 'createQueryBuilder'>>;

  beforeEach(async () => {
    const mockFind = jest.fn();
    const mockDelete = jest.fn().mockResolvedValue({ affected: 1 });
    const mockInsert = jest.fn().mockResolvedValue(undefined);
    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([{ tag: 'ambient' }, { tag: 'chill' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SoundTagService,
        {
          provide: getRepositoryToken(SoundTag),
          useValue: {
            find: mockFind,
            delete: mockDelete,
            insert: mockInsert,
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
          },
        },
      ],
    }).compile();

    service = module.get<SoundTagService>(SoundTagService);
    repo = module.get(getRepositoryToken(SoundTag));
  });

  it('getTags returns tags for category and soundId', async () => {
    (repo.find as jest.Mock).mockResolvedValue([
      { category: 'music', soundId: 's1', tag: 'ambient' },
      { category: 'music', soundId: 's1', tag: 'chill' },
    ]);
    const tags = await service.getTags('music', 's1');
    expect(tags).toEqual(['ambient', 'chill']);
    expect(repo.find).toHaveBeenCalledWith({
      where: { category: 'music', soundId: 's1' },
      order: { tag: 'ASC' },
    });
  });

  it('setTags deletes existing and inserts normalized tags', async () => {
    await service.setTags('music', 's1', ['  Ambient ', 'Chill', 'ambient']);
    expect(repo.delete).toHaveBeenCalledWith({ category: 'music', soundId: 's1' });
    expect(repo.insert).toHaveBeenCalledWith([
      { category: 'music', soundId: 's1', tag: 'ambient' },
      { category: 'music', soundId: 's1', tag: 'chill' },
    ]);
  });

  it('setTags with empty list only deletes', async () => {
    await service.setTags('music', 's1', []);
    expect(repo.delete).toHaveBeenCalledWith({ category: 'music', soundId: 's1' });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('getTagsBySoundIds returns map of soundId to tags', async () => {
    (repo.find as jest.Mock).mockResolvedValue([
      { soundId: 's1', tag: 'a' },
      { soundId: 's1', tag: 'b' },
      { soundId: 's2', tag: 'c' },
    ]);
    const map = await service.getTagsBySoundIds('music', ['s1', 's2']);
    expect(map.get('s1')).toEqual(['a', 'b']);
    expect(map.get('s2')).toEqual(['c']);
    expect(repo.find).toHaveBeenCalledWith({
      where: { category: 'music', soundId: In(['s1', 's2']) },
      order: { tag: 'ASC' },
    });
  });

  it('getTagsBySoundIds returns empty map for empty soundIds', async () => {
    const map = await service.getTagsBySoundIds('music', []);
    expect(map.size).toBe(0);
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('getSoundIdsWithTag returns set of soundIds', async () => {
    (repo.find as jest.Mock).mockResolvedValue([
      { soundId: 's1' },
      { soundId: 's2' },
    ]);
    const set = await service.getSoundIdsWithTag('music', '  Chill ');
    expect(set).toEqual(new Set(['s1', 's2']));
    expect(repo.find).toHaveBeenCalledWith({
      where: { category: 'music', tag: 'chill' },
    });
  });

  it('getDistinctTags returns sorted tags for category', async () => {
    const tags = await service.getDistinctTags('music');
    expect(tags).toEqual(['ambient', 'chill']);
  });
});
