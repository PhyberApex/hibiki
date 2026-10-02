import type { VoiceBasedChannel } from 'discord.js'
import { EventEmitter } from 'node:events'
import * as voice from '@discordjs/voice'
import { GuildAudioManager } from './guild-audio.manager'

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
  AudioPlayerStatus: {},
  getVoiceConnections: jest.fn().mockReturnValue(new Map()),
}))
jest.mock('./audio-engine', () => ({
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
  let status: string = voice.VoiceConnectionStatus.Ready
  connection.destroy = jest.fn(() => {
    const oldStatus = status
    status = voice.VoiceConnectionStatus.Destroyed
    connection.emit('stateChange', { status: oldStatus }, { status: voice.VoiceConnectionStatus.Destroyed })
  })
  return connection
}

const fakeChannel = { id: 'channel-1', name: 'General', guild: { id: 'guild-1', voiceAdapterCreator: jest.fn() } } as unknown as VoiceBasedChannel

/**
 * Flushes the microtask queue so async handlers triggered synchronously by
 * emit() (e.g. the Promise.race in handleDisconnect) have settled.
 */
async function flushAsync(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve))
}

describe('guildAudioManager', () => {
  let manager: GuildAudioManager
  const guildId = 'guild-1'

  beforeEach(() => {
    jest.clearAllMocks()
    ;(voice.entersState as jest.Mock).mockResolvedValue(undefined)
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

    it('does not emit disconnected for a GM-initiated disconnect', () => {
      const connection = createFakeConnection()
      ;(voice.getVoiceConnection as jest.Mock).mockReturnValue(connection)
      const listener = jest.fn()
      manager.on('disconnected', listener)

      manager.disconnect()

      expect(connection.destroy).toHaveBeenCalled()
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('connect: Disconnected handling', () => {
    it('stays connected when the connection recovers within the grace period', async () => {
      const connection = createFakeConnection()
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(connection)
      const listener = jest.fn()

      await manager.connect(fakeChannel)
      manager.on('disconnected', listener)

      ;(voice.entersState as jest.Mock).mockImplementation((_conn, status) => {
        if (status === voice.VoiceConnectionStatus.Signalling)
          return Promise.resolve(undefined)
        return new Promise(() => {})
      })

      connection.emit('stateChange', { status: voice.VoiceConnectionStatus.Ready }, { status: voice.VoiceConnectionStatus.Disconnected })
      await flushAsync()

      expect(connection.destroy).not.toHaveBeenCalled()
      expect(listener).not.toHaveBeenCalled()
      expect(manager.connected).toBe(true)
    })

    it('tears down the connection when it does not recover within the grace period', async () => {
      const connection = createFakeConnection()
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(connection)
      const listener = jest.fn()

      await manager.connect(fakeChannel)
      manager.on('disconnected', listener)

      ;(voice.entersState as jest.Mock).mockImplementation((_conn, status) => {
        if (status === voice.VoiceConnectionStatus.Signalling || status === voice.VoiceConnectionStatus.Connecting)
          return Promise.reject(new Error('timed out'))
        return Promise.resolve(undefined)
      })

      connection.emit('stateChange', { status: voice.VoiceConnectionStatus.Ready }, { status: voice.VoiceConnectionStatus.Disconnected })
      await flushAsync()
      await flushAsync()

      expect(connection.destroy).toHaveBeenCalled()
      expect(listener).toHaveBeenCalledTimes(1)
      expect(manager.connected).toBe(false)
      expect(manager.channelId).toBeUndefined()
    })
  })

  describe('connect: Destroyed handling', () => {
    it('cleans up and emits disconnected when the connection is destroyed from outside', async () => {
      const connection = createFakeConnection()
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(connection)
      const listener = jest.fn()

      await manager.connect(fakeChannel)
      manager.on('disconnected', listener)

      connection.emit('stateChange', { status: voice.VoiceConnectionStatus.Ready }, { status: voice.VoiceConnectionStatus.Destroyed })
      await flushAsync()

      expect(listener).toHaveBeenCalledTimes(1)
      expect(manager.connected).toBe(false)
      expect(manager.channelId).toBeUndefined()
      expect(manager.channelLabel).toBeUndefined()
    })

    it('does not emit disconnected when switching channels destroys the old connection', async () => {
      const firstConnection = createFakeConnection('channel-1')
      const secondConnection = createFakeConnection('channel-2')
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValueOnce(firstConnection).mockReturnValueOnce(secondConnection)
      const listener = jest.fn()

      await manager.connect(fakeChannel)
      manager.on('disconnected', listener)

      const otherChannel = { ...fakeChannel, id: 'channel-2' } as VoiceBasedChannel
      await manager.connect(otherChannel)

      expect(firstConnection.destroy).toHaveBeenCalled()
      expect(listener).not.toHaveBeenCalled()
      expect(manager.connected).toBe(true)
      expect(manager.channelId).toBe('channel-2')
    })
  })
})
