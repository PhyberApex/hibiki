import type { VoiceBasedChannel } from 'discord.js'
import type { DiscordClient } from '../discord/discord-client'
import { EventEmitter } from 'node:events'
import * as voice from '@discordjs/voice'
import { createPlayer } from './player'

jest.mock('@discordjs/voice', () => ({
  getVoiceConnection: jest.fn(),
  joinVoiceChannel: jest.fn(),
  entersState: jest.fn().mockResolvedValue(undefined),
  VoiceConnectionStatus: {
    Ready: 'ready',
    Signalling: 'signalling',
    Connecting: 'connecting',
    Disconnected: 'disconnected',
    Destroyed: 'destroyed',
  },
}))
jest.mock('../audio/audio-engine', () => ({
  AudioEngine: jest.fn().mockImplementation(() => ({
    audioPlayer: { on: jest.fn(), play: jest.fn(), state: { status: 'idle' } },
    playMusicFromStream: jest.fn(),
    playEffectFromStream: jest.fn(),
    stopMusic: jest.fn(),
    getVolumes: jest.fn().mockReturnValue({ music: 100, effects: 100 }),
    setVolumes: jest.fn(),
    destroy: jest.fn(),
  })),
}))

type FakeConnection = EventEmitter & {
  joinConfig: { channelId: string }
  destroy: jest.Mock
  subscribe: jest.Mock
}

function createFakeConnection(channelId = 'channel-1'): FakeConnection {
  const connection = new EventEmitter() as FakeConnection
  connection.joinConfig = { channelId }
  connection.subscribe = jest.fn()
  connection.destroy = jest.fn(() => {
    connection.emit('stateChange', { status: voice.VoiceConnectionStatus.Ready }, { status: voice.VoiceConnectionStatus.Destroyed })
  })
  return connection
}

const fakeChannel = {
  id: 'channel-1',
  name: 'General',
  guild: { id: 'guild-1', name: 'Guild', voiceAdapterCreator: jest.fn() },
} as unknown as VoiceBasedChannel

function createFakeDiscordClient(): DiscordClient {
  return {
    listGuildDirectory: jest.fn().mockReturnValue([]),
    getBotVoiceStateForGuild: jest.fn().mockReturnValue({}),
    leaveVoiceChannel: jest.fn().mockResolvedValue(undefined),
  } as unknown as DiscordClient
}

describe('createPlayer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(voice.entersState as jest.Mock).mockResolvedValue(undefined)
  })

  describe('disconnect', () => {
    it('tears down the manager directly, without destroying the connection out from under its own teardown guard', async () => {
      const connection = createFakeConnection()
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(connection)
      // Mirrors real @discordjs/voice: a joined connection is discoverable
      // via getVoiceConnection(guildId), which manager.disconnect() uses.
      ;(voice.getVoiceConnection as jest.Mock).mockReturnValue(connection)

      const player = createPlayer(createFakeDiscordClient())
      await player.connect(fakeChannel)

      const stateChanged = jest.fn()
      player.onStateChanged(stateChanged)

      await player.disconnect('guild-1')

      expect(connection.destroy).toHaveBeenCalledTimes(1)
      // A GM-initiated disconnect is not an unexpected drop — it must not
      // also fire the auto-teardown push notification.
      expect(stateChanged).not.toHaveBeenCalled()
      expect(await player.getState()).toEqual([])
    })

    it('falls back to destroying any bare connection when no manager is tracked for the guild', async () => {
      const connection = createFakeConnection()
      ;(voice.getVoiceConnection as jest.Mock).mockReturnValue(connection)

      const player = createPlayer(createFakeDiscordClient())
      await player.disconnect('guild-1')

      expect(voice.getVoiceConnection).toHaveBeenCalledWith('guild-1')
      expect(connection.destroy).toHaveBeenCalledTimes(1)
    })
  })

  describe('onStateChanged', () => {
    it('notifies when a connection is torn down from outside (e.g. the grace-period timeout)', async () => {
      const connection = createFakeConnection()
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(connection)

      const player = createPlayer(createFakeDiscordClient())
      await player.connect(fakeChannel)

      const stateChanged = jest.fn()
      player.onStateChanged(stateChanged)

      connection.emit('stateChange', { status: voice.VoiceConnectionStatus.Ready }, { status: voice.VoiceConnectionStatus.Destroyed })
      await new Promise(resolve => setImmediate(resolve))

      expect(stateChanged).toHaveBeenCalledTimes(1)
      expect(await player.getState()).toEqual([])
    })
  })
})
