import type { VoiceBasedChannel } from 'discord.js'
import type { PlayerSnapshotService } from '../persistence/player-snapshot.service'
import type { SoundLibraryService } from '../sound/sound.service'
import { PlayerService } from './player.service'

describe('playerService', () => {
  let service: PlayerService
  let sounds: jest.Mocked<SoundLibraryService>
  let snapshots: jest.Mocked<PlayerSnapshotService>

  const mockFile = {
    id: 'track',
    name: 'Track',
    filename: 'track.mp3',
    category: 'music' as const,
    path: '/tmp/track.mp3',
  }

  const mockChannel = {
    id: 'channel-1',
    guild: { id: 'guild-1', name: 'Test Guild' },
    name: 'General',
    isVoiceBased: () => true,
    guildId: 'guild-1',
    voiceAdapterCreator: {},
  } as unknown as VoiceBasedChannel

  beforeEach(() => {
    sounds = {
      getFile: jest.fn().mockResolvedValue(mockFile),
      getFileByIdOrName: jest.fn().mockResolvedValue(mockFile),
      list: jest.fn().mockResolvedValue([]),
      onModuleInit: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<SoundLibraryService>

    snapshots = {
      upsert: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<PlayerSnapshotService>

    service = new PlayerService(sounds, snapshots)
  })

  it('stops playback without throwing when no manager', async () => {
    await service.stop('unknown')
    expect(snapshots.upsert).not.toHaveBeenCalled()
  })

  it('getState returns live and snapshot merged', async () => {
    const state = await service.getState()
    expect(Array.isArray(state)).toBe(true)
    expect(snapshots.list).toHaveBeenCalled()
  })

  it('playMusic resolves file and persists state', async () => {
    const connectMock = jest.fn().mockResolvedValue(undefined)
    const playMock = jest.fn()
    const persistSpy = jest.spyOn(service as any, 'persistManagerState').mockResolvedValue(undefined)
    jest.spyOn(service as any, 'getOrCreateManager').mockReturnValue({
      connect: connectMock,
      connected: false,
      playMusic: playMock,
    })

    await service.playMusic('guild-1', 'track', mockChannel)

    expect(sounds.getFileByIdOrName).toHaveBeenCalledWith('music', 'track')
    expect(connectMock).toHaveBeenCalledWith(mockChannel)
    expect(playMock).toHaveBeenCalledWith(mockFile.path, expect.any(Object))
    expect(persistSpy).toHaveBeenCalledWith('guild-1', expect.objectContaining({
      trackId: mockFile.id,
      trackName: mockFile.name,
      trackFilename: mockFile.filename,
      trackCategory: mockFile.category,
      isIdle: false,
    }))
  })

  it('playEffect resolves file and triggers effect', async () => {
    const connectMock = jest.fn().mockResolvedValue(undefined)
    const playEffectMock = jest.fn()
    jest.spyOn(service as any, 'getOrCreateManager').mockReturnValue({
      connect: connectMock,
      connected: false,
      playEffect: playEffectMock,
    })
    jest.spyOn(service as any, 'persistManagerState').mockResolvedValue(undefined)

    await service.playEffect('guild-1', 'boom', mockChannel)

    expect(sounds.getFileByIdOrName).toHaveBeenCalledWith('effects', 'boom')
    expect(playEffectMock).toHaveBeenCalledWith(mockFile.path)
  })

  it('disconnect removes manager and snapshot', async () => {
    const destroyMock = jest.fn();
    (service as any).managers.set('guild-1', { disconnect: destroyMock })

    await service.disconnect('guild-1')

    expect(destroyMock).toHaveBeenCalled()
    expect(snapshots.remove).toHaveBeenCalledWith('guild-1')
    expect((service as any).managers.has('guild-1')).toBe(false)
  })

  it('getVolume returns null when no manager for guild', () => {
    expect(service.getVolume('unknown')).toBeNull()
  })

  it('getVolume returns volumes from manager when present', () => {
    (service as any).managers.set('guild-1', {
      getVolumes: () => ({ music: 70, effects: 80 }),
    })
    expect(service.getVolume('guild-1')).toEqual({ music: 70, effects: 80 })
  })

  it('setVolume throws when no manager for guild', () => {
    expect(() =>
      service.setVolume('unknown', { music: 50 }),
    ).toThrow('No player for this guild. Join a voice channel first.')
  })

  it('setVolume updates manager volumes', () => {
    const setVolumes = jest.fn()
    const managers = (service as any).managers as Map<string, { setVolumes: jest.Mock }>
    managers.set('guild-1', { setVolumes })
    service.setVolume('guild-1', { music: 60, effects: 90 })
    expect(setVolumes).toHaveBeenCalledWith({ music: 60, effects: 90 })
  })

  it('getState merges live state with snapshot fallbacks', async () => {
    const manager = {
      channelId: 'ch-1',
      channelLabel: 'General',
      isIdle: true,
      track: null as { id: string, name: string, filename: string, category: string } | null,
      getVolumes: () => ({ music: 85, effects: 90 }),
    };
    (service as any).managers.set('guild-1', manager)
    snapshots.list.mockResolvedValue([
      {
        guildId: 'guild-2',
        connectedChannelId: null,
        connectedChannelName: null,
        isIdle: true,
        trackId: null,
        trackName: null,
        trackFilename: null,
        trackCategory: null,
        updatedAt: new Date('2024-01-01'),
      },
    ] as any)

    const state = await service.getState()

    expect(state.length).toBeGreaterThanOrEqual(1)
    const live = state.find(s => s.source === 'live')
    expect(live?.guildId).toBe('guild-1')
    expect(live?.volume).toEqual({ music: 85, effects: 90 })
    const snapshot = state.find(s => s.source === 'snapshot')
    expect(snapshot?.guildId).toBe('guild-2')
  })

  it('playMusic without channel throws when manager not connected', async () => {
    (service as any).managers.set('guild-1', {
      connect: jest.fn(),
      connected: false,
      playMusic: jest.fn(),
      channelId: null,
      channelLabel: null,
      isIdle: true,
      track: null,
      getVolumes: () => ({ music: 85, effects: 90 }),
    })
    await expect(
      service.playMusic('guild-1', 'track'),
    ).rejects.toThrow('Hibiki is not connected to a voice channel')
  })
})
