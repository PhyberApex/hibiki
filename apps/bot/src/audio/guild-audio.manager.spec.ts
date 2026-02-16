import * as voice from '@discordjs/voice'

import { GuildAudioManager } from './guild-audio.manager'

jest.mock('@discordjs/voice', () => ({
  getVoiceConnection: jest.fn(),
  joinVoiceChannel: jest.fn(),
  entersState: jest.fn().mockResolvedValue(undefined),
  VoiceConnectionStatus: { Ready: 'ready' },
  AudioPlayerStatus: {},
  getVoiceConnections: jest.fn().mockReturnValue(new Map()),
}))
jest.mock('./audio-engine', () => ({
  AudioEngine: jest.fn().mockImplementation(() => ({
    audioPlayer: { on: jest.fn(), play: jest.fn(), state: { status: 'idle' } },
    playMusic: jest.fn(),
    stopMusic: jest.fn(),
    playEffect: jest.fn(),
    getVolumes: jest.fn().mockReturnValue({ music: 100, effects: 100 }),
    setVolumes: jest.fn(),
    destroy: jest.fn(),
  })),
}))

describe('guildAudioManager', () => {
  let manager: GuildAudioManager
  const guildId = 'guild-1'

  beforeEach(() => {
    jest.clearAllMocks()
    manager = new GuildAudioManager(guildId)
  })

  describe('disconnect', () => {
    it('calls getVoiceConnection(guildId)?.destroy() and clears state', () => {
      const destroyMock = jest.fn()
      ;(voice.getVoiceConnection as jest.Mock).mockReturnValue({ destroy: destroyMock })

      manager.disconnect()

      expect(voice.getVoiceConnection).toHaveBeenCalledWith(guildId)
      expect(destroyMock).toHaveBeenCalled()
      expect(manager.channelId).toBeUndefined()
      expect(manager.channelLabel).toBeUndefined()
    })

    it('does not throw when getVoiceConnection returns undefined', () => {
      ;(voice.getVoiceConnection as jest.Mock).mockReturnValue(undefined)

      expect(() => manager.disconnect()).not.toThrow()
    })
  })
})
