import { VoiceBasedChannel } from 'discord.js';
import { SoundLibraryService } from '../sound/sound.service';
import { PlayerService } from './player.service';
import type { PlayerSnapshotService } from '../persistence/player-snapshot.service';

describe('PlayerService', () => {
  let service: PlayerService;
  let sounds: jest.Mocked<SoundLibraryService>;
  let snapshots: jest.Mocked<PlayerSnapshotService>;

  const mockFile = {
    id: 'track',
    name: 'Track',
    filename: 'track.mp3',
    category: 'music' as const,
    path: '/tmp/track.mp3',
  };

  const mockChannel = {
    id: 'channel-1',
    guild: { id: 'guild-1', name: 'Test Guild' },
    name: 'General',
    isVoiceBased: () => true,
    guildId: 'guild-1',
    voiceAdapterCreator: {},
  } as unknown as VoiceBasedChannel;

  beforeEach(() => {
    sounds = {
      getFile: jest.fn().mockResolvedValue(mockFile),
      getFileByIdOrName: jest.fn().mockResolvedValue(mockFile),
      list: jest.fn().mockResolvedValue([]),
      onModuleInit: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<SoundLibraryService>;

    snapshots = {
      upsert: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<PlayerSnapshotService>;

    service = new PlayerService(sounds, snapshots);
  });

  it('stops playback without throwing when no manager', async () => {
    await service.stop('unknown');
    expect(snapshots.upsert).not.toHaveBeenCalled();
  });

  it('getState returns live and snapshot merged', async () => {
    const state = await service.getState();
    expect(Array.isArray(state)).toBe(true);
    expect(snapshots.list).toHaveBeenCalled();
  });

  it('playMusic resolves file and persists state', async () => {
    const connectMock = jest.fn().mockResolvedValue(undefined);
    const playMock = jest.fn();
    const persistSpy = jest.spyOn(service as any, 'persistManagerState').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'getOrCreateManager').mockReturnValue({
      connect: connectMock,
      connected: false,
      playMusic: playMock,
    });

    await service.playMusic('guild-1', 'track', mockChannel);

    expect(sounds.getFileByIdOrName).toHaveBeenCalledWith('music', 'track');
    expect(connectMock).toHaveBeenCalledWith(mockChannel);
    expect(playMock).toHaveBeenCalledWith(mockFile.path, expect.any(Object));
    expect(persistSpy).toHaveBeenCalledWith('guild-1', expect.objectContaining({
      trackId: mockFile.id,
      trackName: mockFile.name,
      trackFilename: mockFile.filename,
      trackCategory: mockFile.category,
      isIdle: false,
    }));
  });

  it('playEffect resolves file and triggers effect', async () => {
    const connectMock = jest.fn().mockResolvedValue(undefined);
    const playEffectMock = jest.fn();
    jest.spyOn(service as any, 'getOrCreateManager').mockReturnValue({
      connect: connectMock,
      connected: false,
      playEffect: playEffectMock,
    });
    jest.spyOn(service as any, 'persistManagerState').mockResolvedValue(undefined);

    await service.playEffect('guild-1', 'boom', mockChannel);

    expect(sounds.getFileByIdOrName).toHaveBeenCalledWith('effects', 'boom');
    expect(playEffectMock).toHaveBeenCalledWith(mockFile.path);
  });

  it('disconnect removes manager and snapshot', async () => {
    const destroyMock = jest.fn();
    (service as any).managers.set('guild-1', { disconnect: destroyMock });

    await service.disconnect('guild-1');

    expect(destroyMock).toHaveBeenCalled();
    expect(snapshots.remove).toHaveBeenCalledWith('guild-1');
    expect((service as any).managers.has('guild-1')).toBe(false);
  });
});

