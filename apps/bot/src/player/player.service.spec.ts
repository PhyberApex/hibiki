import { SoundLibraryService } from '../sound/sound.service';
import { PlayerService } from './player.service';
import { GuildAudioManager } from '../audio/guild-audio.manager';

jest.mock('../audio/guild-audio.manager');

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
    const partialSounds = {
      getFile: jest.fn().mockResolvedValue(mockFile),
    } satisfies Partial<SoundLibraryService>;
    sounds = partialSounds as jest.Mocked<SoundLibraryService>;

    const partialSnapshots = {
      upsert: jest.fn(),
      remove: jest.fn(),
      list: jest.fn().mockResolvedValue([]),
    } satisfies Partial<PlayerSnapshotService>;
    snapshots = partialSnapshots as jest.Mocked<PlayerSnapshotService>;
    service = new PlayerService(sounds, snapshots);
  });

  it('stops playback without throwing when idle', async () => {
    await service.stop('unknown');
    expect(true).toBe(true);
  });
});
