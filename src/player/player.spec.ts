import type { VoiceBasedChannel } from 'discord.js'
import type { DiscordClient } from '../discord/discord-client'
import type { SoundLibrary } from '../sound/sound-library'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import * as voice from '@discordjs/voice'
import { AudioEngine } from '../audio/audio-engine'
import { createPcmStream } from '../audio/decoders'
import { LOCAL_TARGET_ID } from './output-target'
import { createPlayer } from './player'

jest.mock('@discordjs/voice', () => ({
  getVoiceConnection: jest.fn(),
  joinVoiceChannel: jest.fn(),
  entersState: jest.fn().mockResolvedValue(undefined),
  NetworkingStatusCode: { Ready: 4 },
  VoiceConnectionStatus: {
    Ready: 'ready',
    Signalling: 'signalling',
    Connecting: 'connecting',
    Disconnected: 'disconnected',
    Destroyed: 'destroyed',
  },
  AudioPlayerStatus: { Idle: 'idle' },
}))
jest.mock('../audio/audio-engine', () => ({
  AudioEngine: jest.fn().mockImplementation(() => ({
    audioPlayer: {
      on: jest.fn(),
      play: jest.fn(),
      state: { status: 'idle' },
    },
    isIdle: true,
    stopLocalSink: jest.fn(),
    playMusicFromStream: jest.fn(),
    playEffectFromStream: jest.fn(),
    setEffectStreamVolume: jest.fn(),
    stopMusic: jest.fn(),
    stopAllMusic: jest.fn(),
    setStreamVolume: jest.fn(),
    rampStreamVolume: jest.fn(),
    destroy: jest.fn(),
  })),
}))
jest.mock('../audio/decoders', () => ({
  createPcmStream: jest.fn(),
}))

/** The mocked AudioEngine instance the most recently constructed manager is using. */
function getEngineMock(): {
  playMusicFromStream: jest.Mock
  playEffectFromStream: jest.Mock
  setEffectStreamVolume: jest.Mock
  stopMusic: jest.Mock
  stopAllMusic: jest.Mock
  setStreamVolume: jest.Mock
  rampStreamVolume: jest.Mock
  stopLocalSink: jest.Mock
} {
  const results = (AudioEngine as unknown as jest.Mock).mock.results
  return results[results.length - 1].value
}

function createFakeSoundLibrary(overrides: Partial<SoundLibrary> = {}): SoundLibrary {
  return {
    getFile: jest.fn(),
    ...overrides,
  } as unknown as SoundLibrary
}

/** A real, fully consumable Readable — unlike Music/Ambience's bare EventEmitter fakes, `playEffect` actually reads this to completion via the PCM cache. */
function fakePcmStream(data = 'pcm'): Readable {
  return Readable.from([
    Buffer.from(data),
  ])
}

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
  guild: {
    id: 'guild-1',
    name: 'Guild',
    voiceAdapterCreator: jest.fn(),
  },
} as unknown as VoiceBasedChannel

function fakeChannelFor(guildId: string): VoiceBasedChannel {
  return {
    id: `${guildId}-channel`,
    name: 'General',
    guild: {
      id: guildId,
      name: guildId,
      voiceAdapterCreator: jest.fn(),
    },
  } as unknown as VoiceBasedChannel
}

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

  describe('local Target', () => {
    const localSink = () => ({
      start: jest.fn(),
      write: jest.fn(),
      stop: jest.fn(),
    })

    it('reports no Local entry until the Target is used, then one without a channel', async () => {
      const sounds = createFakeSoundLibrary({
        getFile: jest.fn().mockResolvedValue({
          id: 'song',
          name: 'Song',
          filename: 's.mp3',
          category: 'music',
          path: '/s.mp3',
        }),
      })
      const player = createPlayer(createFakeDiscordClient(), sounds, {
        localSink: localSink(),
      })
      expect(await player.getState()).toEqual([])

      await player.playMusic(LOCAL_TARGET_ID, 'song', { volume: 50 })

      const state = await player.getState()
      expect(state).toHaveLength(1)
      expect(state[0]).toMatchObject({ targetId: 'local', kind: 'local', isIdle: true })
      expect(state[0].connectedChannelId).toBeUndefined()
    })

    it('plays Music, Ambience and Effects on the Local Target without a voice connection', async () => {
      const sounds = createFakeSoundLibrary({
        getFile: jest.fn().mockResolvedValue({
          id: 'x',
          name: 'X',
          filename: 'x.mp3',
          category: 'music',
          path: '/x.mp3',
        }),
        getFilePath: jest.fn().mockResolvedValue('/x.mp3'),
      })
      ;(createPcmStream as jest.Mock).mockImplementation(() => fakePcmStream())
      const player = createPlayer(createFakeDiscordClient(), sounds, {
        localSink: localSink(),
      })

      await player.playMusic(LOCAL_TARGET_ID, 'a', { volume: 50 })
      await player.playAmbience(LOCAL_TARGET_ID, 'b', { volume: 50, repeatMin: 0, repeatMax: 0 })
      await player.playEffect(LOCAL_TARGET_ID, 'c', { volume: 50 })

      expect(sounds.getFile).toHaveBeenCalledTimes(2)
      expect(sounds.getFilePath).toHaveBeenCalledWith('effects', 'c')
      expect(getEngineMock().playMusicFromStream).toHaveBeenCalledTimes(3)
      expect(() => player.startStream(LOCAL_TARGET_ID, new Readable({
        read() {},
      }))).not.toThrow()
      expect(() => player.startEffectStream(LOCAL_TARGET_ID, new Readable({
        read() {},
      }), 'browser-1', 50)).not.toThrow()
      expect(() => player.setEffectStreamVolume(LOCAL_TARGET_ID, 'browser-1', 50)).not.toThrow()
      expect(getEngineMock().playEffectFromStream).not.toHaveBeenCalled()
      expect(getEngineMock().setEffectStreamVolume).not.toHaveBeenCalled()
    })

    it('refuses Local playback when no sink exists', async () => {
      const player = createPlayer(createFakeDiscordClient(), createFakeSoundLibrary())
      await expect(player.playMusic(LOCAL_TARGET_ID, 'a', { volume: 50 })).rejects.toThrow('Local output is not available')
    })

    it('stops local playback when the sink reports it is dead', async () => {
      const sounds = createFakeSoundLibrary({
        getFile: jest.fn().mockResolvedValue({
          id: 'x',
          name: 'X',
          filename: 'x.mp3',
          category: 'music',
          path: '/x.mp3',
        }),
      })
      const player = createPlayer(createFakeDiscordClient(), sounds, {
        localSink: localSink(),
      })
      await player.playMusic(LOCAL_TARGET_ID, 'a', { volume: 50 })

      player.reportLocalSinkHealth({ type: 'underruns', count: 3 })
      player.reportLocalSinkHealth({ type: 'suspended' })
      expect(getEngineMock().stopLocalSink).not.toHaveBeenCalled()

      player.reportLocalSinkHealth({ type: 'failed', message: 'context closed' })
      expect(getEngineMock().stopAllMusic).toHaveBeenCalled()
      expect(getEngineMock().stopLocalSink).toHaveBeenCalled()
    })

    it('does not touch Discord on disconnect', async () => {
      const discord = createFakeDiscordClient()
      const player = createPlayer(discord, createFakeSoundLibrary())
      await player.disconnect(LOCAL_TARGET_ID)
      expect(discord.leaveVoiceChannel).not.toHaveBeenCalled()
      expect(voice.getVoiceConnection).not.toHaveBeenCalled()
    })

    it('tags Discord entries with their guild id as the Target id', async () => {
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(createFakeConnection())
      const player = createPlayer(createFakeDiscordClient(), createFakeSoundLibrary())
      await player.connect(fakeChannel)
      expect((await player.getState())[0]).toMatchObject({ targetId: 'guild-1', kind: 'discord', guildId: 'guild-1' })
    })
  })

  describe('disconnect', () => {
    it('tears down the manager directly, without destroying the connection out from under its own teardown guard', async () => {
      const connection = createFakeConnection()
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(connection)
      // Mirrors real @discordjs/voice: a joined connection is discoverable
      // via getVoiceConnection(guildId), which manager.disconnect() uses.
      ;(voice.getVoiceConnection as jest.Mock).mockReturnValue(connection)

      const player = createPlayer(createFakeDiscordClient(), createFakeSoundLibrary())
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

      const player = createPlayer(createFakeDiscordClient(), createFakeSoundLibrary())
      await player.disconnect('guild-1')

      expect(voice.getVoiceConnection).toHaveBeenCalledWith('guild-1')
      expect(connection.destroy).toHaveBeenCalledTimes(1)
    })
  })

  describe('onStateChanged', () => {
    it('notifies when a connection is torn down from outside (e.g. the grace-period timeout)', async () => {
      const connection = createFakeConnection()
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(connection)

      const player = createPlayer(createFakeDiscordClient(), createFakeSoundLibrary())
      await player.connect(fakeChannel)

      const stateChanged = jest.fn()
      player.onStateChanged(stateChanged)

      connection.emit('stateChange', { status: voice.VoiceConnectionStatus.Ready }, { status: voice.VoiceConnectionStatus.Destroyed })
      await new Promise(resolve => setImmediate(resolve))

      expect(stateChanged).toHaveBeenCalledTimes(1)
      expect(await player.getState()).toEqual([])
    })
  })

  describe('music stream ids', () => {
    async function connectedPlayer() {
      const connection = createFakeConnection()
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(connection)
      const player = createPlayer(createFakeDiscordClient(), createFakeSoundLibrary())
      await player.connect(fakeChannel)
      return player
    }

    it('startStream forwards an optional streamId to the manager', async () => {
      const player = await connectedPlayer()
      const stream = new EventEmitter() as unknown as import('node:stream').Readable

      player.startStream('guild-1', stream, undefined, 'a')

      expect(getEngineMock().playMusicFromStream).toHaveBeenCalledWith(stream, 'a', undefined, expect.any(Function))
    })

    it('stopStream forwards an optional streamId to the manager, without stopping other streams', async () => {
      const player = await connectedPlayer()

      player.stopStream('guild-1', 'a')

      expect(getEngineMock().stopMusic).toHaveBeenCalledWith('a')
      expect(getEngineMock().stopAllMusic).not.toHaveBeenCalled()
    })

    it('startEffectStream forwards the stream id and initial volume, and setEffectStreamVolume reaches that engine', async () => {
      const player = await connectedPlayer()
      const stream = new EventEmitter() as unknown as import('node:stream').Readable

      player.startEffectStream('guild-1', stream, 'browser-3', 45)
      player.setEffectStreamVolume('guild-1', 'browser-3', 20)

      expect(getEngineMock().playEffectFromStream).toHaveBeenCalledWith(stream, 'browser-3', 45)
      expect(getEngineMock().setEffectStreamVolume).toHaveBeenCalledWith('browser-3', 20)
    })

    it('setEffectStreamVolume is a no-op for a guild without a manager', () => {
      const player = createPlayer(createFakeDiscordClient(), createFakeSoundLibrary())
      expect(() => player.setEffectStreamVolume('guild-9', 'browser-3', 20)).not.toThrow()
    })

    it('stop (the guild-level Stop action) ends every music stream, not just one id', async () => {
      const player = await connectedPlayer()

      await player.stop('guild-1')

      expect(getEngineMock().stopAllMusic).toHaveBeenCalledTimes(1)
    })
  })

  describe('playMusic / stopMusic / setMusicVolume', () => {
    async function connectedPlayer(sounds: SoundLibrary) {
      const connection = createFakeConnection()
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(connection)
      const player = createPlayer(createFakeDiscordClient(), sounds)
      await player.connect(fakeChannel)
      return player
    }

    it('resolves the sound, decodes it, and starts it on the manager', async () => {
      const file = {
        id: 's1',
        name: 'Song',
        filename: 's1.mp3',
        category: 'music' as const,
        path: '/music/s1.mp3',
      }
      const sounds = createFakeSoundLibrary({
        getFile: jest.fn().mockResolvedValue(file),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      const stream = new EventEmitter()
      createPcmStream.mockResolvedValue(stream)

      await player.playMusic('guild-1', 's1', { volume: 80, loop: true })

      expect(sounds.getFile).toHaveBeenCalledWith('music', 's1')
      expect(createPcmStream).toHaveBeenCalledWith('/music/s1.mp3')
      expect(getEngineMock().playMusicFromStream).toHaveBeenCalledWith(stream, expect.any(String), 80, expect.any(Function))
    })

    it('throws when the guild is not connected', async () => {
      const sounds = createFakeSoundLibrary()
      const player = createPlayer(createFakeDiscordClient(), sounds)

      await expect(player.playMusic('guild-1', 's1', { volume: 80 })).rejects.toThrow('Not connected')
    })

    it('throws when the join timed out before the connection became ready (#645)', async () => {
      const sounds = createFakeSoundLibrary()
      const player = createPlayer(createFakeDiscordClient(), sounds)
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(createFakeConnection())
      ;(voice.entersState as jest.Mock).mockRejectedValue(new Error('The operation was aborted'))

      await expect(player.connect(fakeChannel)).rejects.toThrow('The operation was aborted')

      await expect(player.playMusic('guild-1', 's1', { volume: 80 })).rejects.toThrow('Not connected')
      expect(sounds.getFile).not.toHaveBeenCalled()
    })

    it('stopMusic forwards fadeOutMs to the manager and is a no-op without a manager', async () => {
      const file = {
        id: 's1',
        name: 'Song',
        filename: 's1.mp3',
        category: 'music' as const,
        path: '/music/s1.mp3',
      }
      const sounds = createFakeSoundLibrary({
        getFile: jest.fn().mockResolvedValue(file),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      createPcmStream.mockResolvedValue(new EventEmitter())
      await player.playMusic('guild-1', 's1', { volume: 80 })

      player.stopMusic('guild-1', { fadeOutMs: 500 })

      expect(getEngineMock().rampStreamVolume).toHaveBeenCalledWith(expect.any(String), 0, 500, expect.any(Function))
      expect(() => player.stopMusic('guild-nope')).not.toThrow()
    })

    it('setMusicVolume forwards to the manager and throws without a manager', async () => {
      const file = {
        id: 's1',
        name: 'Song',
        filename: 's1.mp3',
        category: 'music' as const,
        path: '/music/s1.mp3',
      }
      const sounds = createFakeSoundLibrary({
        getFile: jest.fn().mockResolvedValue(file),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      createPcmStream.mockResolvedValue(new EventEmitter())
      await player.playMusic('guild-1', 's1', { volume: 80 })

      player.setMusicVolume('guild-1', 40)

      expect(getEngineMock().setStreamVolume).toHaveBeenCalledWith(expect.any(String), 40)
      expect(() => player.setMusicVolume('guild-nope', 40)).toThrow('No player for this guild')
    })

    it('notifies onStateChanged when the track changes (e.g. starts or ends)', async () => {
      const file = {
        id: 's1',
        name: 'Song',
        filename: 's1.mp3',
        category: 'music' as const,
        path: '/music/s1.mp3',
      }
      const sounds = createFakeSoundLibrary({
        getFile: jest.fn().mockResolvedValue(file),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      createPcmStream.mockResolvedValue(new EventEmitter())
      const stateChanged = jest.fn()
      player.onStateChanged(stateChanged)

      await player.playMusic('guild-1', 's1', { volume: 80 })

      expect(stateChanged).toHaveBeenCalledTimes(1)
    })
  })

  describe('playAmbience / stopAmbience / setAmbienceVolume', () => {
    async function connectedPlayer(sounds: SoundLibrary) {
      const connection = createFakeConnection()
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(connection)
      const player = createPlayer(createFakeDiscordClient(), sounds)
      await player.connect(fakeChannel)
      return player
    }

    it('resolves the sound from the ambience category, decodes it, and starts it on the manager', async () => {
      const file = {
        id: 'rain',
        name: 'Rain',
        filename: 'rain.mp3',
        category: 'ambience' as const,
        path: '/ambience/rain.mp3',
      }
      const sounds = createFakeSoundLibrary({
        getFile: jest.fn().mockResolvedValue(file),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      const stream = new EventEmitter()
      createPcmStream.mockResolvedValue(stream)

      await player.playAmbience('guild-1', 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })

      expect(sounds.getFile).toHaveBeenCalledWith('ambience', 'rain')
      expect(createPcmStream).toHaveBeenCalledWith('/ambience/rain.mp3')
      expect(getEngineMock().playMusicFromStream).toHaveBeenCalledWith(stream, expect.any(String), 70, expect.any(Function))
    })

    it('throws when the guild is not connected', async () => {
      const sounds = createFakeSoundLibrary()
      const player = createPlayer(createFakeDiscordClient(), sounds)

      await expect(player.playAmbience('guild-1', 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })).rejects.toThrow('Not connected')
    })

    it('stopAmbience forwards fadeOutMs to the manager and is a no-op without a manager', async () => {
      const file = {
        id: 'rain',
        name: 'Rain',
        filename: 'rain.mp3',
        category: 'ambience' as const,
        path: '/ambience/rain.mp3',
      }
      const sounds = createFakeSoundLibrary({
        getFile: jest.fn().mockResolvedValue(file),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      createPcmStream.mockResolvedValue(new EventEmitter())
      await player.playAmbience('guild-1', 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })

      player.stopAmbience('guild-1', 'rain', { fadeOutMs: 500 })

      expect(getEngineMock().rampStreamVolume).toHaveBeenCalledWith(expect.any(String), 0, 500, expect.any(Function))
      expect(() => player.stopAmbience('guild-nope', 'rain')).not.toThrow()
    })

    it('setAmbienceVolume forwards to the manager and throws without a manager', async () => {
      const file = {
        id: 'rain',
        name: 'Rain',
        filename: 'rain.mp3',
        category: 'ambience' as const,
        path: '/ambience/rain.mp3',
      }
      const sounds = createFakeSoundLibrary({
        getFile: jest.fn().mockResolvedValue(file),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      createPcmStream.mockResolvedValue(new EventEmitter())
      await player.playAmbience('guild-1', 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })

      player.setAmbienceVolume('guild-1', 'rain', 40)

      expect(getEngineMock().setStreamVolume).toHaveBeenCalledWith(expect.any(String), 40)
      expect(() => player.setAmbienceVolume('guild-nope', 'rain', 40)).toThrow('No player for this guild')
    })

    it('several Ambience sounds can play at once, reported by getState()\'s ambience field', async () => {
      const files: Record<string, { id: string, name: string, filename: string, category: 'ambience', path: string }> = {
        rain: {
          id: 'rain',
          name: 'Rain',
          filename: 'rain.mp3',
          category: 'ambience',
          path: '/ambience/rain.mp3',
        },
        wind: {
          id: 'wind',
          name: 'Wind',
          filename: 'wind.mp3',
          category: 'ambience',
          path: '/ambience/wind.mp3',
        },
      }
      const sounds = createFakeSoundLibrary({
        getFile: jest.fn().mockImplementation((_category, id) => Promise.resolve(files[id])),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      createPcmStream.mockImplementation(() => Promise.resolve(new EventEmitter()))

      await player.playAmbience('guild-1', 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })
      await player.playAmbience('guild-1', 'wind', { volume: 50, repeatMin: 0, repeatMax: 0 })

      const [state] = await player.getState()
      expect(state.ambience?.sort()).toEqual(['rain', 'wind'])
    })

    it('the guild-level Stop action ends active Ambience sounds too, not just Music', async () => {
      const file = {
        id: 'rain',
        name: 'Rain',
        filename: 'rain.mp3',
        category: 'ambience' as const,
        path: '/ambience/rain.mp3',
      }
      const sounds = createFakeSoundLibrary({
        getFile: jest.fn().mockResolvedValue(file),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      createPcmStream.mockResolvedValue(new EventEmitter())
      await player.playAmbience('guild-1', 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })

      await player.stop('guild-1')

      const [state] = await player.getState()
      expect(state.ambience).toEqual([])
    })

    it('notifies onStateChanged when an Ambience sound starts or stops', async () => {
      const file = {
        id: 'rain',
        name: 'Rain',
        filename: 'rain.mp3',
        category: 'ambience' as const,
        path: '/ambience/rain.mp3',
      }
      const sounds = createFakeSoundLibrary({
        getFile: jest.fn().mockResolvedValue(file),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      createPcmStream.mockResolvedValue(new EventEmitter())
      const stateChanged = jest.fn()
      player.onStateChanged(stateChanged)

      await player.playAmbience('guild-1', 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })
      expect(stateChanged).toHaveBeenCalledTimes(1)

      player.stopAmbience('guild-1', 'rain')
      expect(stateChanged).toHaveBeenCalledTimes(2)
    })
  })

  describe('playEffect / stopEffects', () => {
    async function connectedPlayer(sounds: SoundLibrary) {
      const connection = createFakeConnection()
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(connection)
      const player = createPlayer(createFakeDiscordClient(), sounds)
      await player.connect(fakeChannel)
      return player
    }

    it('resolves the sound\'s path (not the fuller getFile(), which would also stat and read tags for no reason here), decodes it, and plays it through the manager at the given volume', async () => {
      const sounds = createFakeSoundLibrary({
        getFilePath: jest.fn().mockResolvedValue('/effects/fx1.mp3'),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      createPcmStream.mockResolvedValue(fakePcmStream())

      await player.playEffect('guild-1', 'fx1', { volume: 90 })

      expect(sounds.getFilePath).toHaveBeenCalledWith('effects', 'fx1')
      expect(createPcmStream).toHaveBeenCalledWith('/effects/fx1.mp3')
      expect(getEngineMock().playMusicFromStream).toHaveBeenCalledWith(expect.anything(), expect.any(String), 90, expect.any(Function))
    })

    it('throws when the guild is not connected', async () => {
      const sounds = createFakeSoundLibrary()
      const player = createPlayer(createFakeDiscordClient(), sounds)

      await expect(player.playEffect('guild-1', 'fx1', { volume: 90 })).rejects.toThrow('Not connected')
    })

    it('triggering the same Effect twice layers two instances, each its own mixer input', async () => {
      const sounds = createFakeSoundLibrary({
        getFilePath: jest.fn().mockResolvedValue('/effects/fx1.mp3'),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      createPcmStream.mockImplementation(() => Promise.resolve(fakePcmStream()))

      await player.playEffect('guild-1', 'fx1', { volume: 90 })
      await player.playEffect('guild-1', 'fx1', { volume: 90 })

      expect(getEngineMock().playMusicFromStream).toHaveBeenCalledTimes(2)
      const [idA, idB] = getEngineMock().playMusicFromStream.mock.calls.map(call => call[1])
      expect(idA).not.toBe(idB)
    })

    it('serves a second trigger of the same Effect from the PCM cache, without decoding again', async () => {
      const sounds = createFakeSoundLibrary({
        getFilePath: jest.fn().mockResolvedValue('/effects/fx1.mp3'),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      createPcmStream.mockImplementation(() => Promise.resolve(fakePcmStream()))

      await player.playEffect('guild-1', 'fx1', { volume: 90 })
      await player.playEffect('guild-1', 'fx1', { volume: 90 })

      expect(createPcmStream).toHaveBeenCalledTimes(1)
      expect(getEngineMock().playMusicFromStream).toHaveBeenCalledTimes(2)
    })

    it('stopEffects forwards to the manager and is a no-op without a manager', async () => {
      const sounds = createFakeSoundLibrary({
        getFilePath: jest.fn().mockResolvedValue('/effects/fx1.mp3'),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      createPcmStream.mockResolvedValue(fakePcmStream())
      await player.playEffect('guild-1', 'fx1', { volume: 90 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      player.stopEffects('guild-1')

      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(streamId)
      expect(() => player.stopEffects('guild-nope')).not.toThrow()
    })

    it('the guild-level Stop action ends active Effects too, not just Music and Ambience', async () => {
      const sounds = createFakeSoundLibrary({
        getFilePath: jest.fn().mockResolvedValue('/effects/fx1.mp3'),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      createPcmStream.mockResolvedValue(fakePcmStream())
      await player.playEffect('guild-1', 'fx1', { volume: 90 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      await player.stop('guild-1')

      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(streamId)
    })

    it('resolves with the new instance\'s id and a duration derived from the decoded PCM length (#509)', async () => {
      const sounds = createFakeSoundLibrary({
        getFilePath: jest.fn().mockResolvedValue('/effects/fx1.mp3'),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      // 1920 bytes of 48 kHz stereo 16-bit PCM is exactly 10 ms.
      createPcmStream.mockResolvedValue(fakePcmStream('x'.repeat(1920)))

      const result = await player.playEffect('guild-1', 'fx1', { volume: 90 })

      expect(result.soundId).toBe('fx1')
      expect(result.durationMs).toBe(10)
      expect(result.instanceId).toEqual(expect.any(String))
    })

    it('getState() lists active backend Effect Instances for the guild', async () => {
      const sounds = createFakeSoundLibrary({
        getFilePath: jest.fn().mockResolvedValue('/effects/fx1.mp3'),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      createPcmStream.mockResolvedValue(fakePcmStream())

      const { instanceId, startedAt, durationMs } = await player.playEffect('guild-1', 'fx1', { volume: 90 })

      const [state] = await player.getState()
      expect(state.effects).toEqual([
        {
          instanceId,
          soundId: 'fx1',
          startedAt,
          durationMs,
        },
      ])
    })

    it('stopEffect ends one instance by id via the manager, leaving the others untouched, and is a no-op without a manager', async () => {
      const sounds = createFakeSoundLibrary({
        getFilePath: jest.fn().mockResolvedValue('/effects/fx1.mp3'),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      createPcmStream.mockImplementation(() => Promise.resolve(fakePcmStream()))
      const first = await player.playEffect('guild-1', 'fx1', { volume: 90 })
      await player.playEffect('guild-1', 'fx1', { volume: 90 })

      player.stopEffect('guild-1', first.instanceId)

      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(first.instanceId)
      expect(getEngineMock().stopMusic).toHaveBeenCalledTimes(1)
      expect(() => player.stopEffect('guild-nope', 'whatever')).not.toThrow()
    })

    it('notifies onStateChanged when an Effect instance starts or ends', async () => {
      const sounds = createFakeSoundLibrary({
        getFilePath: jest.fn().mockResolvedValue('/effects/fx1.mp3'),
      })
      const player = await connectedPlayer(sounds)
      const { createPcmStream } = jest.requireMock('../audio/decoders') as { createPcmStream: jest.Mock }
      createPcmStream.mockResolvedValue(fakePcmStream())
      const stateChanged = jest.fn()
      player.onStateChanged(stateChanged)

      const { instanceId } = await player.playEffect('guild-1', 'fx1', { volume: 90 })
      expect(stateChanged).toHaveBeenCalledTimes(1)

      player.stopEffect('guild-1', instanceId)
      expect(stateChanged).toHaveBeenCalledTimes(2)
    })
  })

  describe('disconnectAllVoice', () => {
    it('leaves voice in every Discord guild and keeps the Local Target playing', async () => {
      const connections: Record<string, FakeConnection> = {
        'guild-1': createFakeConnection('channel-a'),
        'guild-2': createFakeConnection('channel-b'),
      }
      ;(voice.joinVoiceChannel as jest.Mock)
        .mockReturnValueOnce(connections['guild-1'])
        .mockReturnValueOnce(connections['guild-2'])
      ;(voice.getVoiceConnection as jest.Mock).mockImplementation((guildId: string) => connections[guildId])
      const sounds = createFakeSoundLibrary({
        getFile: jest.fn().mockResolvedValue({
          id: 'x',
          name: 'X',
          filename: 'x.mp3',
          category: 'music',
          path: '/x.mp3',
        }),
      })
      const player = createPlayer(createFakeDiscordClient(), sounds, {
        localSink: {
          start: jest.fn(),
          write: jest.fn(),
          stop: jest.fn(),
        },
      })
      await player.connect(fakeChannelFor('guild-1'))
      await player.connect(fakeChannelFor('guild-2'))
      await player.playMusic(LOCAL_TARGET_ID, 'x', { volume: 50 })
      const localEngine = getEngineMock()
      const stateChanged = jest.fn()
      player.onStateChanged(stateChanged)

      await player.disconnectAllVoice()

      expect(connections['guild-1'].destroy).toHaveBeenCalledTimes(1)
      expect(connections['guild-2'].destroy).toHaveBeenCalledTimes(1)
      expect(localEngine.stopAllMusic).not.toHaveBeenCalled()
      expect((await player.getState()).map(s => s.targetId)).toEqual([LOCAL_TARGET_ID])
      expect(stateChanged).toHaveBeenCalledTimes(1)
    })
  })

  describe('destroyAll', () => {
    it('destroys every connected guild\'s manager and clears live state', async () => {
      const connectionA = createFakeConnection('channel-a')
      const connectionB = createFakeConnection('channel-b')
      ;(voice.joinVoiceChannel as jest.Mock)
        .mockReturnValueOnce(connectionA)
        .mockReturnValueOnce(connectionB)

      const player = createPlayer(createFakeDiscordClient(), createFakeSoundLibrary())
      await player.connect(fakeChannelFor('guild-1'))
      await player.connect(fakeChannelFor('guild-2'))

      await player.destroyAll()

      expect(connectionA.destroy).toHaveBeenCalledTimes(1)
      expect(connectionB.destroy).toHaveBeenCalledTimes(1)
      expect(await player.getState()).toEqual([])
    })

    it('does not emit a spurious disconnected notification for intentional teardown', async () => {
      const connection = createFakeConnection()
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(connection)

      const player = createPlayer(createFakeDiscordClient(), createFakeSoundLibrary())
      await player.connect(fakeChannel)
      const stateChanged = jest.fn()
      player.onStateChanged(stateChanged)

      await player.destroyAll()

      expect(stateChanged).not.toHaveBeenCalled()
    })

    it('tears down every other guild even when one manager throws during its own teardown', async () => {
      const connectionA = createFakeConnection('channel-a')
      connectionA.destroy = jest.fn(() => {
        throw new Error('boom')
      })
      const connectionB = createFakeConnection('channel-b')
      ;(voice.joinVoiceChannel as jest.Mock)
        .mockReturnValueOnce(connectionA)
        .mockReturnValueOnce(connectionB)

      const player = createPlayer(createFakeDiscordClient(), createFakeSoundLibrary())
      await player.connect(fakeChannelFor('guild-1'))
      await player.connect(fakeChannelFor('guild-2'))

      await expect(player.destroyAll()).resolves.toBeUndefined()

      expect(connectionB.destroy).toHaveBeenCalledTimes(1)
    })
  })
})
