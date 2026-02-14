import { SoundLibraryService } from '../sound/sound.service';
import { PlayerService } from './player.service';
import type { PlayerSnapshotService } from '../persistence/player-snapshot.service';

describe('PlayerService', () => {
  let service: PlayerService;
  let sounds: jest.Mocked<SoundLibraryService>;
  let snapshots: jest.Mocked<PlayerSnapshotService>;

  beforeEach(() => {
    const mockFile = {
      id: 'track',
      name: 'Track',
      filename: 'track.mp3',
      category: 'music',
      path: '/tmp/track.mp3',
    } as const;

    sounds = {
      getFile: jest.fn().mockResolvedValue(mockFile),
      getFileByIdOrName: jest.fn().mockResolvedValue(mockFile),
      list: jest.fn().mockResolvedValue([]),
      onModuleInit: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<SoundLibraryService>;

    snapshots = {
      upsert: jest.fn(),
      remove: jest.fn(),
      list: jest.fn().mockResolvedValue([]),
      repo: {} as PlayerSnapshotService['repo'],
    } as unknown as jest.Mocked<PlayerSnapshotService>;

    service = new PlayerService(sounds, snapshots);
  });

  it('stops playback without throwing when idle', async () => {
    await service.stop('unknown');
    expect(true).toBe(true);
  });
});
