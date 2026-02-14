import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlayerSnapshotService } from './player-snapshot.service';
import { PlayerSnapshot } from './player-snapshot.entity';

describe('PlayerSnapshotService', () => {
  let service: PlayerSnapshotService;
  let repo: jest.Mocked<Pick<Repository<PlayerSnapshot>, 'create' | 'save' | 'delete' | 'find'>>;

  beforeEach(async () => {
    const mockCreate = jest.fn().mockImplementation((entity: Partial<PlayerSnapshot>) => entity);
    const mockSave = jest.fn().mockResolvedValue(undefined);
    const mockDelete = jest.fn().mockResolvedValue({ affected: 1 });
    const mockFind = jest.fn().mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlayerSnapshotService,
        {
          provide: getRepositoryToken(PlayerSnapshot),
          useValue: {
            create: mockCreate,
            save: mockSave,
            delete: mockDelete,
            find: mockFind,
          },
        },
      ],
    }).compile();

    service = module.get<PlayerSnapshotService>(PlayerSnapshotService);
    repo = module.get(getRepositoryToken(PlayerSnapshot));
  });

  it('upsert creates and saves snapshot', async () => {
    await service.upsert({
      guildId: 'guild-1',
      connectedChannelId: 'ch-1',
      connectedChannelName: 'General',
      trackId: 't1',
      trackName: 'Track',
      trackFilename: 'track.mp3',
      trackCategory: 'music',
      isIdle: false,
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        connectedChannelId: 'ch-1',
        connectedChannelName: 'General',
        trackId: 't1',
        trackName: 'Track',
        trackFilename: 'track.mp3',
        trackCategory: 'music',
        isIdle: false,
      }),
    );
    expect(repo.save).toHaveBeenCalled();
  });

  it('upsert defaults nulls and isIdle', async () => {
    await service.upsert({ guildId: 'guild-1' });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        guildId: 'guild-1',
        connectedChannelId: null,
        connectedChannelName: null,
        trackId: null,
        trackName: null,
        trackFilename: null,
        trackCategory: null,
        isIdle: true,
      }),
    );
  });

  it('remove deletes by guildId', async () => {
    await service.remove('guild-1');
    expect(repo.delete).toHaveBeenCalledWith({ guildId: 'guild-1' });
  });

  it('list returns snapshots ordered by updatedAt desc', async () => {
    const snapshots = [
      { guildId: 'g1', updatedAt: new Date() },
      { guildId: 'g2', updatedAt: new Date() },
    ];
    (repo.find as jest.Mock).mockResolvedValue(snapshots);
    const list = await service.list();
    expect(list).toEqual(snapshots);
    expect(repo.find).toHaveBeenCalledWith({ order: { updatedAt: 'DESC' } });
  });
});
