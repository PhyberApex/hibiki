import { SoundLibraryService } from '../sound/sound.service'
import { PlayerService } from './player.service'
import { GuildAudioManager } from '../audio/guild-audio.manager'

jest.mock('../audio/guild-audio.manager')

describe('PlayerService', () => {
  let service: PlayerService
  let sounds: jest.Mocked<SoundLibraryService>

  beforeEach(() => {
    sounds = {
      getFile: jest.fn().mockResolvedValue({
        id: 'track',
        name: 'Track',
        filename: 'track.mp3',
        category: 'music',
        path: '/tmp/track.mp3',
      } as any),
    } as unknown as jest.Mocked<SoundLibraryService>

    service = new PlayerService(sounds)
  })

  it('connects and reuses managers per guild', async () => {
    const channel: any = { guild: { id: '123', name: 'Guild' }, name: 'voice' }
    await service.connect(channel)
    await service.connect(channel)

    expect(GuildAudioManager).toHaveBeenCalledTimes(1)
  })

  it('stops playback without throwing when idle', async () => {
    await service.stop('unknown')
    expect(true).toBe(true)
  })
})
