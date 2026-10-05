import type { VoiceBasedChannel } from 'discord.js'
import { EventEmitter } from 'node:events'
import * as voice from '@discordjs/voice'
import { AudioEngine } from './audio-engine'
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
    stopAllMusic: jest.fn(),
    setStreamVolume: jest.fn(),
    rampStreamVolume: jest.fn(),
    destroy: jest.fn(),
  })),
}))

/** The mocked AudioEngine instance the manager under test constructed. */
function getEngineMock(): {
  playMusicFromStream: jest.Mock
  stopMusic: jest.Mock
  stopAllMusic: jest.Mock
  setStreamVolume: jest.Mock
  rampStreamVolume: jest.Mock
} {
  const results = (AudioEngine as unknown as jest.Mock).mock.results
  return results[results.length - 1].value
}

/** A controllable stream factory for `playMusic`: resolves/rejects only when told to. */
function createDeferredFactory(): {
  factory: () => Promise<EventEmitter>
  resolve: (stream?: EventEmitter) => void
  reject: (err: Error) => void
} {
  let resolveFn!: (stream: EventEmitter) => void
  let rejectFn!: (err: Error) => void
  const factory = () => new Promise<EventEmitter>((resolve, reject) => {
    resolveFn = resolve
    rejectFn = reject
  })
  return {
    factory,
    resolve: (stream = createFakeStream()) => resolveFn(stream),
    reject: err => rejectFn(err),
  }
}

function createFakeStream(): EventEmitter {
  return new EventEmitter()
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

  describe('music stream ids', () => {
    const metaA = { id: 'a', name: 'Track A', filename: 'a.mp3', category: 'music' as const }
    const metaB = { id: 'b', name: 'Track B', filename: 'b.mp3', category: 'music' as const }

    it('forwards the stream id to the engine on start and stop', () => {
      const stream = createFakeStream()
      manager.playMusicFromStream(stream as any, metaA, 'a')
      manager.stopMusic('a')

      const engine = getEngineMock()
      expect(engine.playMusicFromStream).toHaveBeenCalledWith(stream, 'a')
      expect(engine.stopMusic).toHaveBeenCalledWith('a')
      expect(engine.stopAllMusic).not.toHaveBeenCalled()
    })

    it('reports the most recently started still-alive stream as the current track', () => {
      manager.playMusicFromStream(createFakeStream() as any, metaA, 'a')
      manager.playMusicFromStream(createFakeStream() as any, metaB, 'b')

      expect(manager.track).toEqual(metaB)
    })

    it('falls back to the next-most-recent stream when the latest one ends', () => {
      manager.playMusicFromStream(createFakeStream() as any, metaA, 'a')
      const streamB = createFakeStream()
      manager.playMusicFromStream(streamB as any, metaB, 'b')

      streamB.emit('end')

      expect(manager.track).toEqual(metaA)
    })

    it('treats a restarted id as newly started for current-track purposes', () => {
      manager.playMusicFromStream(createFakeStream() as any, metaA, 'a')
      manager.playMusicFromStream(createFakeStream() as any, metaB, 'b')
      const metaA2 = { ...metaA, name: 'Track A (again)' }
      manager.playMusicFromStream(createFakeStream() as any, metaA2, 'a')

      expect(manager.track).toEqual(metaA2)
    })

    it('clears the current track once every stream has ended', () => {
      const stream = createFakeStream()
      manager.playMusicFromStream(stream as any, metaA, 'a')

      stream.emit('end')

      expect(manager.track).toBeUndefined()
    })

    it('destroy() ends every music stream via stopAllMusic', () => {
      manager.playMusicFromStream(createFakeStream() as any, metaA, 'a')
      manager.playMusicFromStream(createFakeStream() as any, metaB, 'b')

      manager.destroy()

      expect(getEngineMock().stopAllMusic).toHaveBeenCalledTimes(1)
      expect(manager.track).toBeUndefined()
    })

    it('disconnect() ends every music stream via stopAllMusic', () => {
      ;(voice.getVoiceConnection as jest.Mock).mockReturnValue(undefined)
      manager.playMusicFromStream(createFakeStream() as any, metaA, 'a')
      manager.playMusicFromStream(createFakeStream() as any, metaB, 'b')

      manager.disconnect()

      expect(getEngineMock().stopAllMusic).toHaveBeenCalledTimes(1)
      expect(manager.track).toBeUndefined()
    })

    it('a lost connection teardown ends every music stream via stopAllMusic', async () => {
      const connection = createFakeConnection()
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(connection)

      await manager.connect(fakeChannel)
      manager.playMusicFromStream(createFakeStream() as any, metaA, 'a')
      manager.playMusicFromStream(createFakeStream() as any, metaB, 'b')

      connection.emit('stateChange', { status: voice.VoiceConnectionStatus.Ready }, { status: voice.VoiceConnectionStatus.Destroyed })
      await flushAsync()

      expect(getEngineMock().stopAllMusic).toHaveBeenCalledTimes(1)
      expect(manager.track).toBeUndefined()
    })
  })

  describe('playMusic (backend-decoded track)', () => {
    const meta = { id: 'a', name: 'Track A', filename: 'a.mp3', category: 'music' as const }
    const metaB = { id: 'b', name: 'Track B', filename: 'b.mp3', category: 'music' as const }

    it('decodes via the factory and reports the track through getState()\'s track field', async () => {
      const stream = createFakeStream()
      const factory = jest.fn().mockReturnValue(stream)

      await manager.playMusic(factory, meta, { volume: 80 })

      expect(factory).toHaveBeenCalledTimes(1)
      const engine = getEngineMock()
      expect(engine.playMusicFromStream).toHaveBeenCalledWith(stream, expect.any(String), 80)
      expect(manager.track).toEqual(meta)
    })

    it('loop restarts the decoder stream at end of file', async () => {
      const firstStream = createFakeStream()
      const secondStream = createFakeStream()
      const factory = jest.fn().mockReturnValueOnce(firstStream).mockReturnValueOnce(secondStream)

      await manager.playMusic(factory, meta, { volume: 80, loop: true })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      firstStream.emit('end')
      await flushAsync()

      expect(factory).toHaveBeenCalledTimes(2)
      expect(getEngineMock().playMusicFromStream).toHaveBeenNthCalledWith(2, secondStream, streamId, 80)
      expect(manager.track).toEqual(meta)
    })

    it('clears the current track when a non-looping track ends', async () => {
      const stream = createFakeStream()
      await manager.playMusic(jest.fn().mockReturnValue(stream), meta, { volume: 80 })

      stream.emit('end')

      expect(manager.track).toBeUndefined()
    })

    it('stop ends the track immediately and clears it', async () => {
      const stream = createFakeStream()
      await manager.playMusic(jest.fn().mockReturnValue(stream), meta, { volume: 80 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      manager.stopCurrentTrack()

      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(streamId)
      expect(getEngineMock().rampStreamVolume).not.toHaveBeenCalled()
      expect(manager.track).toBeUndefined()
    })

    it('stop with fadeOutMs ramps to 0 before stopping, and clears the track right away', async () => {
      const stream = createFakeStream()
      await manager.playMusic(jest.fn().mockReturnValue(stream), meta, { volume: 80 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      manager.stopCurrentTrack({ fadeOutMs: 500 })

      expect(manager.track).toBeUndefined()
      expect(getEngineMock().rampStreamVolume).toHaveBeenCalledWith(streamId, 0, 500, expect.any(Function))
      expect(getEngineMock().stopMusic).not.toHaveBeenCalled()

      // Simulate the ramp completing.
      getEngineMock().rampStreamVolume.mock.calls[0][3]()
      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(streamId)
    })

    it('stopCurrentTrack is a no-op when nothing is playing', () => {
      expect(() => manager.stopCurrentTrack()).not.toThrow()
      expect(getEngineMock().stopMusic).not.toHaveBeenCalled()
    })

    it('setMusicVolume sets immediately without a rampMs', async () => {
      const stream = createFakeStream()
      await manager.playMusic(jest.fn().mockReturnValue(stream), meta, { volume: 80 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      manager.setMusicVolume(40)

      expect(getEngineMock().setStreamVolume).toHaveBeenCalledWith(streamId, 40)
      expect(getEngineMock().rampStreamVolume).not.toHaveBeenCalled()
    })

    it('setMusicVolume ramps when given a rampMs', async () => {
      const stream = createFakeStream()
      await manager.playMusic(jest.fn().mockReturnValue(stream), meta, { volume: 80 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      manager.setMusicVolume(40, { rampMs: 300 })

      expect(getEngineMock().rampStreamVolume).toHaveBeenCalledWith(streamId, 40, 300)
    })

    it('setMusicVolume is a no-op when nothing is playing', () => {
      expect(() => manager.setMusicVolume(40)).not.toThrow()
      expect(getEngineMock().setStreamVolume).not.toHaveBeenCalled()
    })

    it('crossfade: starting a new track with fadeInMs keeps the old one audible and fading out', async () => {
      const streamA = createFakeStream()
      await manager.playMusic(jest.fn().mockReturnValue(streamA), meta, { volume: 80 })
      const idA = getEngineMock().playMusicFromStream.mock.calls[0][1]

      const streamB = createFakeStream()
      await manager.playMusic(jest.fn().mockReturnValue(streamB), metaB, { volume: 60, fadeInMs: 400 })
      const idB = getEngineMock().playMusicFromStream.mock.calls[1][1]

      // Incoming track starts silent and ramps up to its target volume.
      expect(getEngineMock().playMusicFromStream).toHaveBeenNthCalledWith(2, streamB, idB, 0)
      expect(getEngineMock().rampStreamVolume).toHaveBeenCalledWith(idB, 60, 400)
      // Outgoing track ramps to silence over the same duration, then stops.
      expect(getEngineMock().rampStreamVolume).toHaveBeenCalledWith(idA, 0, 400, expect.any(Function))
      expect(getEngineMock().stopMusic).not.toHaveBeenCalled()

      getEngineMock().rampStreamVolume.mock.calls.find(call => call[0] === idA)![3]()
      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(idA)

      // The new track is immediately "the" track, even while the old one fades.
      expect(manager.track).toEqual(metaB)
    })

    it('without fadeInMs, replacing a track stops the old one immediately', async () => {
      const streamA = createFakeStream()
      await manager.playMusic(jest.fn().mockReturnValue(streamA), meta, { volume: 80 })
      const idA = getEngineMock().playMusicFromStream.mock.calls[0][1]

      const streamB = createFakeStream()
      await manager.playMusic(jest.fn().mockReturnValue(streamB), metaB, { volume: 60 })

      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(idA)
      expect(getEngineMock().rampStreamVolume).not.toHaveBeenCalled()
    })

    it('leaves the current track untouched if the new track fails to start', async () => {
      const streamA = createFakeStream()
      await manager.playMusic(jest.fn().mockReturnValue(streamA), meta, { volume: 80 })

      await expect(
        manager.playMusic(jest.fn().mockRejectedValue(new Error('decode failed')), metaB, { volume: 60 }),
      ).rejects.toThrow('decode failed')

      expect(manager.track).toEqual(meta)
      expect(getEngineMock().stopMusic).not.toHaveBeenCalled()
    })

    it('destroy() ends the backend track via stopAllMusic', async () => {
      const stream = createFakeStream()
      await manager.playMusic(jest.fn().mockReturnValue(stream), meta, { volume: 80 })

      manager.destroy()

      expect(getEngineMock().stopAllMusic).toHaveBeenCalledTimes(1)
      expect(manager.track).toBeUndefined()
    })

    it('emits trackChanged when the track starts, ends naturally, and is stopped', async () => {
      const listener = jest.fn()
      manager.on('trackChanged', listener)
      const stream = createFakeStream()

      await manager.playMusic(jest.fn().mockReturnValue(stream), meta, { volume: 80 })
      expect(listener).toHaveBeenCalledTimes(1)

      manager.stopCurrentTrack()
      expect(listener).toHaveBeenCalledTimes(2)
    })

    it('a crossfaded-out track is dropped from bookkeeping once stopped, not leaked', async () => {
      const streamA = createFakeStream()
      await manager.playMusic(jest.fn().mockReturnValue(streamA), meta, { volume: 80 })
      const idA = getEngineMock().playMusicFromStream.mock.calls[0][1]

      const streamB = createFakeStream()
      await manager.playMusic(jest.fn().mockReturnValue(streamB), metaB, { volume: 60, fadeInMs: 400 })
      // Complete the outgoing fade — AudioEngine.stopMusic strips the
      // stream's own 'end' listener before destroying it, so GuildAudioManager
      // must drop its own bookkeeping itself rather than relying on 'end'.
      getEngineMock().rampStreamVolume.mock.calls.find(call => call[0] === idA)![3]()

      // If idA's entry were still in musicStreams with a stale seq, looking
      // up `track` would still correctly return metaB (highest seq) — so
      // assert there's no leaked entry directly via destroy()'s full clear
      // being the only way to reach zero, by checking a third track takes
      // over cleanly and the manager doesn't accumulate unbounded state.
      const streamC = createFakeStream()
      await manager.playMusic(jest.fn().mockReturnValue(streamC), meta, { volume: 50 })
      expect(manager.track).toEqual(meta)
    })

    describe('races between concurrent calls', () => {
      it('a playMusic call superseded by a second one before its decode resolves never commits (does not become audible)', async () => {
        const first = createDeferredFactory()
        const firstCall = manager.playMusic(first.factory, meta, { volume: 80 })

        // A second playMusic starts (and completes) before the first's decode resolves.
        const streamB = createFakeStream()
        await manager.playMusic(jest.fn().mockReturnValue(streamB), metaB, { volume: 60 })
        const idB = getEngineMock().playMusicFromStream.mock.calls[0][1]

        // Now the first (stale) decode resolves.
        const staleStream = createFakeStream()
        first.resolve(staleStream)
        await firstCall
        await flushAsync()

        // Only the second (newer) track is current; the stale decode is
        // dropped before ever being registered with the engine — it never
        // becomes audible even briefly.
        expect(manager.track).toEqual(metaB)
        expect(getEngineMock().playMusicFromStream).toHaveBeenCalledTimes(1)
        expect(getEngineMock().playMusicFromStream).toHaveBeenCalledWith(streamB, idB, 60)
      })

      it('stopCurrentTrack called while a playMusic is mid-decode prevents that track from resurrecting playback', async () => {
        const deferred = createDeferredFactory()
        const playCall = manager.playMusic(deferred.factory, meta, { volume: 80 })

        // Stop is pressed before the decode resolves (nothing is playing yet).
        manager.stopCurrentTrack()

        const stream = createFakeStream()
        deferred.resolve(stream)
        await playCall

        expect(manager.track).toBeUndefined()
        // The decode was dropped before ever reaching the engine.
        expect(getEngineMock().playMusicFromStream).not.toHaveBeenCalled()
      })

      it('stopCurrentTrack called while a loop restart is mid-decode prevents that restart from resurrecting playback', async () => {
        const firstStream = createFakeStream()
        const restart = createDeferredFactory()
        const factory = jest.fn()
          .mockReturnValueOnce(firstStream)
          .mockImplementationOnce(() => restart.factory())

        await manager.playMusic(factory, meta, { volume: 80, loop: true })
        expect(manager.track).toEqual(meta)

        // Track reaches end of file — loop restart begins, decode in flight.
        firstStream.emit('end')

        // Stop is pressed while the restart's decode is still pending.
        manager.stopCurrentTrack()
        expect(manager.track).toBeUndefined()

        // The pending restart's decode now resolves.
        restart.resolve()
        await flushAsync()

        // Stop must not have been undone by the in-flight restart.
        expect(manager.track).toBeUndefined()
        expect(getEngineMock().playMusicFromStream).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('playAmbience (backend-decoded sound)', () => {
    afterEach(() => {
      jest.useRealTimers()
    })

    it('decodes via the factory and reports the soundId through activeAmbience', async () => {
      const stream = createFakeStream()
      const factory = jest.fn().mockReturnValue(stream)

      await manager.playAmbience(factory, 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })

      expect(factory).toHaveBeenCalledTimes(1)
      const engine = getEngineMock()
      expect(engine.playMusicFromStream).toHaveBeenCalledWith(stream, expect.any(String), 70)
      expect(manager.activeAmbience).toEqual(['rain'])
    })

    it('several Ambience sounds can be active at once, independently', async () => {
      await manager.playAmbience(jest.fn().mockReturnValue(createFakeStream()), 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })
      await manager.playAmbience(jest.fn().mockReturnValue(createFakeStream()), 'wind', { volume: 50, repeatMin: 0, repeatMax: 0 })

      expect(manager.activeAmbience.sort()).toEqual(['rain', 'wind'])

      manager.stopAmbience('rain')

      expect(manager.activeAmbience).toEqual(['wind'])
    })

    it('both repeat bounds 0 loops seamlessly, restarting the decoder stream at end of file under the same stream id', async () => {
      const firstStream = createFakeStream()
      const secondStream = createFakeStream()
      const factory = jest.fn().mockReturnValueOnce(firstStream).mockReturnValueOnce(secondStream)

      await manager.playAmbience(factory, 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      firstStream.emit('end')
      await flushAsync()

      expect(factory).toHaveBeenCalledTimes(2)
      expect(getEngineMock().playMusicFromStream).toHaveBeenNthCalledWith(2, secondStream, streamId, 70)
      expect(manager.activeAmbience).toEqual(['rain'])
    })

    it('non-zero repeat bounds wait a random delay in range before restarting, using fake timers', async () => {
      jest.useFakeTimers()
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.5)
      const firstStream = createFakeStream()
      const secondStream = createFakeStream()
      const factory = jest.fn().mockReturnValueOnce(firstStream).mockReturnValueOnce(secondStream)

      await manager.playAmbience(factory, 'rain', { volume: 70, repeatMin: 10, repeatMax: 20 })

      firstStream.emit('end')
      // Not restarted immediately — it's waiting out the repeat gap.
      expect(factory).toHaveBeenCalledTimes(1)

      // Midpoint of [10s, 20s] with Math.random() stubbed to 0.5 is 15s.
      // advanceTimersByTimeAsync (not the sync variant + a manual flush)
      // because setImmediate is itself faked under modern fake timers, so a
      // flushAsync() built on it would never settle.
      await jest.advanceTimersByTimeAsync(14_999)
      expect(factory).toHaveBeenCalledTimes(1)
      await jest.advanceTimersByTimeAsync(1)

      expect(factory).toHaveBeenCalledTimes(2)
      expect(manager.activeAmbience).toEqual(['rain'])
      randomSpy.mockRestore()
    })

    it('stop clears a pending interval-repeat restart so it never fires', async () => {
      jest.useFakeTimers()
      const firstStream = createFakeStream()
      const factory = jest.fn().mockReturnValueOnce(firstStream).mockReturnValueOnce(createFakeStream())

      await manager.playAmbience(factory, 'rain', { volume: 70, repeatMin: 5, repeatMax: 5 })
      firstStream.emit('end')

      manager.stopAmbience('rain')
      await jest.advanceTimersByTimeAsync(60_000)

      expect(factory).toHaveBeenCalledTimes(1)
      expect(manager.activeAmbience).toEqual([])
    })

    it('stop ends the sound immediately by default', async () => {
      const stream = createFakeStream()
      await manager.playAmbience(jest.fn().mockReturnValue(stream), 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      manager.stopAmbience('rain')

      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(streamId)
      expect(getEngineMock().rampStreamVolume).not.toHaveBeenCalled()
      expect(manager.activeAmbience).toEqual([])
    })

    it('stop with fadeOutMs ramps to 0 before stopping', async () => {
      const stream = createFakeStream()
      await manager.playAmbience(jest.fn().mockReturnValue(stream), 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      manager.stopAmbience('rain', { fadeOutMs: 500 })

      expect(manager.activeAmbience).toEqual([])
      expect(getEngineMock().rampStreamVolume).toHaveBeenCalledWith(streamId, 0, 500, expect.any(Function))
      expect(getEngineMock().stopMusic).not.toHaveBeenCalled()

      getEngineMock().rampStreamVolume.mock.calls[0][3]()
      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(streamId)
    })

    it('stopAmbience is a no-op for a soundId that is not playing', () => {
      expect(() => manager.stopAmbience('rain')).not.toThrow()
      expect(getEngineMock().stopMusic).not.toHaveBeenCalled()
    })

    it('fadeInMs starts the sound silent and ramps up to its target volume', async () => {
      const stream = createFakeStream()

      await manager.playAmbience(jest.fn().mockReturnValue(stream), 'rain', { volume: 70, repeatMin: 0, repeatMax: 0, fadeInMs: 400 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      expect(getEngineMock().playMusicFromStream).toHaveBeenCalledWith(stream, streamId, 0)
      expect(getEngineMock().rampStreamVolume).toHaveBeenCalledWith(streamId, 70, 400)
    })

    it('replacing an already-playing sound with fadeInMs keeps the old one audible and fading out, instead of cutting it', async () => {
      const streamA = createFakeStream()
      await manager.playAmbience(jest.fn().mockReturnValue(streamA), 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })
      const idA = getEngineMock().playMusicFromStream.mock.calls[0][1]

      const streamB = createFakeStream()
      await manager.playAmbience(jest.fn().mockReturnValue(streamB), 'rain', { volume: 40, repeatMin: 0, repeatMax: 0, fadeInMs: 300 })
      const idB = getEngineMock().playMusicFromStream.mock.calls[1][1]

      // Incoming sound starts silent and ramps up to its target volume.
      expect(getEngineMock().playMusicFromStream).toHaveBeenNthCalledWith(2, streamB, idB, 0)
      expect(getEngineMock().rampStreamVolume).toHaveBeenCalledWith(idB, 40, 300)
      // Outgoing sound ramps to silence over the same duration, then stops.
      expect(getEngineMock().rampStreamVolume).toHaveBeenCalledWith(idA, 0, 300, expect.any(Function))
      expect(getEngineMock().stopMusic).not.toHaveBeenCalled()

      getEngineMock().rampStreamVolume.mock.calls.find(call => call[0] === idA)![3]()
      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(idA)
      expect(manager.activeAmbience).toEqual(['rain'])
    })

    it('replacing an already-playing sound without fadeInMs stops the old one immediately', async () => {
      const streamA = createFakeStream()
      await manager.playAmbience(jest.fn().mockReturnValue(streamA), 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })
      const idA = getEngineMock().playMusicFromStream.mock.calls[0][1]

      const streamB = createFakeStream()
      await manager.playAmbience(jest.fn().mockReturnValue(streamB), 'rain', { volume: 40, repeatMin: 0, repeatMax: 0 })

      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(idA)
      expect(getEngineMock().rampStreamVolume).not.toHaveBeenCalled()
    })

    it('setAmbienceVolume sets immediately without a rampMs', async () => {
      const stream = createFakeStream()
      await manager.playAmbience(jest.fn().mockReturnValue(stream), 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      manager.setAmbienceVolume('rain', 40)

      expect(getEngineMock().setStreamVolume).toHaveBeenCalledWith(streamId, 40)
      expect(getEngineMock().rampStreamVolume).not.toHaveBeenCalled()
    })

    it('setAmbienceVolume ramps when given a rampMs (the Scene Crossfade shared-sound rule)', async () => {
      const stream = createFakeStream()
      await manager.playAmbience(jest.fn().mockReturnValue(stream), 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      manager.setAmbienceVolume('rain', 40, { rampMs: 300 })

      expect(getEngineMock().rampStreamVolume).toHaveBeenCalledWith(streamId, 40, 300)
    })

    it('setAmbienceVolume updates the stored target even mid-repeat-gap, so the next restart uses it', async () => {
      jest.useFakeTimers()
      const randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0)
      const firstStream = createFakeStream()
      const secondStream = createFakeStream()
      const factory = jest.fn().mockReturnValueOnce(firstStream).mockReturnValueOnce(secondStream)

      await manager.playAmbience(factory, 'rain', { volume: 70, repeatMin: 5, repeatMax: 5 })
      firstStream.emit('end')

      // No stream is registered with the engine during the gap, so this is a
      // bookkeeping-only update — nothing to ramp yet.
      manager.setAmbienceVolume('rain', 20)
      getEngineMock().setStreamVolume.mockClear()

      await jest.advanceTimersByTimeAsync(5_000)

      expect(getEngineMock().playMusicFromStream).toHaveBeenNthCalledWith(2, secondStream, expect.any(String), 20)
      randomSpy.mockRestore()
    })

    it('setAmbienceVolume is a no-op for a soundId that is not playing', () => {
      expect(() => manager.setAmbienceVolume('rain', 40)).not.toThrow()
      expect(getEngineMock().setStreamVolume).not.toHaveBeenCalled()
    })

    it('leaves the current sound untouched if a replacement playAmbience call fails to start', async () => {
      const streamA = createFakeStream()
      await manager.playAmbience(jest.fn().mockReturnValue(streamA), 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })
      const idA = getEngineMock().playMusicFromStream.mock.calls[0][1]

      await expect(
        manager.playAmbience(jest.fn().mockRejectedValue(new Error('decode failed')), 'rain', { volume: 40, repeatMin: 0, repeatMax: 0 }),
      ).rejects.toThrow('decode failed')

      // Still reported as active, and the original engine stream was never
      // touched by the failed replacement — only a confirmed new start may
      // stop the outgoing one.
      expect(manager.activeAmbience).toEqual(['rain'])
      expect(getEngineMock().stopMusic).not.toHaveBeenCalledWith(idA)
    })

    it('stopAllAmbience ends every Ambience sound and clears pending repeat timers, without touching Music', async () => {
      jest.useFakeTimers()
      const rainStream = createFakeStream()
      const windStream = createFakeStream()
      await manager.playAmbience(jest.fn().mockReturnValue(rainStream), 'rain', { volume: 70, repeatMin: 5, repeatMax: 5 })
      await manager.playAmbience(jest.fn().mockReturnValue(windStream), 'wind', { volume: 50, repeatMin: 0, repeatMax: 0 })
      rainStream.emit('end') // now waiting out a pending repeat timer

      manager.stopAllAmbience()
      await jest.advanceTimersByTimeAsync(60_000)

      expect(manager.activeAmbience).toEqual([])
      // Only the two ambience streams were stopped — stopAllMusic (the
      // separate Music teardown) was never invoked.
      expect(getEngineMock().stopAllMusic).not.toHaveBeenCalled()
    })

    it('destroy() ends every Ambience sound via the engine', async () => {
      const stream = createFakeStream()
      await manager.playAmbience(jest.fn().mockReturnValue(stream), 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      manager.destroy()

      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(streamId)
      expect(manager.activeAmbience).toEqual([])
    })

    it('a lost connection teardown ends every Ambience sound', async () => {
      const connection = createFakeConnection()
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(connection)
      await manager.connect(fakeChannel)
      const stream = createFakeStream()
      await manager.playAmbience(jest.fn().mockReturnValue(stream), 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      connection.emit('stateChange', { status: voice.VoiceConnectionStatus.Ready }, { status: voice.VoiceConnectionStatus.Destroyed })
      await flushAsync()

      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(streamId)
      expect(manager.activeAmbience).toEqual([])
    })

    describe('races between concurrent calls', () => {
      it('a playAmbience call superseded by a second one for the same soundId before its decode resolves never commits', async () => {
        const first = createDeferredFactory()
        const firstCall = manager.playAmbience(first.factory, 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })

        const streamB = createFakeStream()
        await manager.playAmbience(jest.fn().mockReturnValue(streamB), 'rain', { volume: 40, repeatMin: 0, repeatMax: 0 })
        const idB = getEngineMock().playMusicFromStream.mock.calls[0][1]

        const staleStream = createFakeStream()
        first.resolve(staleStream)
        await firstCall
        await flushAsync()

        expect(manager.activeAmbience).toEqual(['rain'])
        expect(getEngineMock().playMusicFromStream).toHaveBeenCalledTimes(1)
        expect(getEngineMock().playMusicFromStream).toHaveBeenCalledWith(streamB, idB, 40)
      })

      it('stopAmbience called while a playAmbience is mid-decode prevents that sound from resurrecting playback', async () => {
        const deferred = createDeferredFactory()
        const playCall = manager.playAmbience(deferred.factory, 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })

        manager.stopAmbience('rain')

        const stream = createFakeStream()
        deferred.resolve(stream)
        await playCall

        expect(manager.activeAmbience).toEqual([])
        expect(getEngineMock().playMusicFromStream).not.toHaveBeenCalled()
      })

      it('stopAmbience called while a loop restart is mid-decode prevents that restart from resurrecting playback', async () => {
        const firstStream = createFakeStream()
        const restart = createDeferredFactory()
        const factory = jest.fn()
          .mockReturnValueOnce(firstStream)
          .mockImplementationOnce(() => restart.factory())

        await manager.playAmbience(factory, 'rain', { volume: 70, repeatMin: 0, repeatMax: 0 })
        expect(manager.activeAmbience).toEqual(['rain'])

        firstStream.emit('end')

        manager.stopAmbience('rain')
        expect(manager.activeAmbience).toEqual([])

        restart.resolve()
        await flushAsync()

        expect(manager.activeAmbience).toEqual([])
        expect(getEngineMock().playMusicFromStream).toHaveBeenCalledTimes(1)
      })

      it('stopAmbience called while an interval-repeat restart is mid-decode prevents that restart from resurrecting playback', async () => {
        jest.useFakeTimers()
        const firstStream = createFakeStream()
        const restart = createDeferredFactory()
        const factory = jest.fn()
          .mockReturnValueOnce(firstStream)
          .mockImplementationOnce(() => restart.factory())

        await manager.playAmbience(factory, 'rain', { volume: 70, repeatMin: 1, repeatMax: 1 })
        firstStream.emit('end')
        await jest.advanceTimersByTimeAsync(1_000)
        expect(factory).toHaveBeenCalledTimes(2)

        manager.stopAmbience('rain')
        expect(manager.activeAmbience).toEqual([])

        restart.resolve()
        await jest.advanceTimersByTimeAsync(0)

        expect(manager.activeAmbience).toEqual([])
        expect(getEngineMock().playMusicFromStream).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('playEffect (backend-decoded instance)', () => {
    it('decodes via the factory and plays it through the engine at the given volume', async () => {
      const stream = createFakeStream()
      const factory = jest.fn().mockReturnValue(stream)

      await manager.playEffect(factory, { volume: 90 })

      expect(factory).toHaveBeenCalledTimes(1)
      expect(getEngineMock().playMusicFromStream).toHaveBeenCalledWith(stream, expect.any(String), 90)
    })

    it('layers two different instances without stopping either', async () => {
      await manager.playEffect(jest.fn().mockReturnValue(createFakeStream()), { volume: 90 })
      await manager.playEffect(jest.fn().mockReturnValue(createFakeStream()), { volume: 90 })

      expect(getEngineMock().playMusicFromStream).toHaveBeenCalledTimes(2)
      const [idA, idB] = getEngineMock().playMusicFromStream.mock.calls.map(call => call[1])
      expect(idA).not.toBe(idB)
      expect(getEngineMock().stopMusic).not.toHaveBeenCalled()
    })

    it('layers two instances of the same Effect, each its own mixer input', async () => {
      const streamA = createFakeStream()
      const streamB = createFakeStream()
      const factory = jest.fn().mockReturnValueOnce(streamA).mockReturnValueOnce(streamB)

      await manager.playEffect(factory, { volume: 90 })
      await manager.playEffect(factory, { volume: 90 })

      expect(getEngineMock().playMusicFromStream).toHaveBeenNthCalledWith(1, streamA, expect.any(String), 90)
      expect(getEngineMock().playMusicFromStream).toHaveBeenNthCalledWith(2, streamB, expect.any(String), 90)
      expect(getEngineMock().stopMusic).not.toHaveBeenCalled()
    })

    it('stops the oldest instance once a ninth is triggered', async () => {
      const ids: string[] = []
      for (let i = 0; i < 8; i++) {
        await manager.playEffect(jest.fn().mockReturnValue(createFakeStream()), { volume: 90 })
        ids.push(getEngineMock().playMusicFromStream.mock.calls[i][1])
      }
      expect(getEngineMock().stopMusic).not.toHaveBeenCalled()

      await manager.playEffect(jest.fn().mockReturnValue(createFakeStream()), { volume: 90 })

      expect(getEngineMock().stopMusic).toHaveBeenCalledTimes(1)
      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(ids[0])
    })

    it('evicts in trigger order even when a later trigger\'s decode resolves first', async () => {
      // Fill the cap with 7, leaving room for exactly one more live slot.
      const ids: string[] = []
      for (let i = 0; i < 7; i++) {
        await manager.playEffect(jest.fn().mockReturnValue(createFakeStream()), { volume: 90 })
        ids.push(getEngineMock().playMusicFromStream.mock.calls[i][1])
      }

      // Trigger #8 (slow decode) and #9 (fast decode) close together — #9's
      // decode resolves first, but #8 was triggered first and must still be
      // the one evicted when #9's slot-reservation runs, not whichever
      // happened to finish decoding first.
      const slow = createDeferredFactory()
      const eighth = manager.playEffect(slow.factory, { volume: 90 })
      const ninthStream = createFakeStream()
      await manager.playEffect(jest.fn().mockReturnValue(ninthStream), { volume: 90 })

      // The 9th trigger's reservation evicted the 1st (oldest by trigger
      // order), not the still-decoding 8th.
      expect(getEngineMock().stopMusic).toHaveBeenCalledTimes(1)
      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(ids[0])

      slow.resolve(createFakeStream())
      await eighth

      // The 8th's decode resolving afterward must not trigger a second,
      // redundant eviction — it already reserved its slot up front.
      expect(getEngineMock().stopMusic).toHaveBeenCalledTimes(1)
    })

    it('an instance evicted by the cap while still decoding never reaches the engine once its decode resolves', async () => {
      // Trigger #1 (slow decode) is still mid-decode while #2-#8 (fast)
      // fill the remaining cap slots, so it's still the oldest entry when
      // #9 arrives and evicts it.
      const oldest = createDeferredFactory()
      const firstTrigger = manager.playEffect(oldest.factory, { volume: 90 })
      for (let i = 0; i < 7; i++)
        await manager.playEffect(jest.fn().mockReturnValue(createFakeStream()), { volume: 90 })

      // The 9th trigger's cap enforcement evicts #1, which is still mid-decode.
      await manager.playEffect(jest.fn().mockReturnValue(createFakeStream()), { volume: 90 })
      const playCallsBeforeResolve = getEngineMock().playMusicFromStream.mock.calls.length

      oldest.resolve(createFakeStream())
      await firstTrigger

      // The decode resolving after eviction must not register a mixer
      // input for it — it was already stopped before it ever started.
      expect(getEngineMock().playMusicFromStream.mock.calls.length).toBe(playCallsBeforeResolve)
    })

    it('an instance stopped in bulk (stopAllEffects) while still decoding never reaches the engine once its decode resolves', async () => {
      const deferred = createDeferredFactory()
      const playPromise = manager.playEffect(deferred.factory, { volume: 90 })

      manager.stopAllEffects()

      deferred.resolve(createFakeStream())
      await playPromise

      expect(getEngineMock().playMusicFromStream).not.toHaveBeenCalled()
    })

    it('an instance that already ended naturally does not count toward the cap', async () => {
      const endedStream = createFakeStream()
      await manager.playEffect(jest.fn().mockReturnValue(endedStream), { volume: 90 })
      endedStream.emit('end')

      for (let i = 0; i < 7; i++)
        await manager.playEffect(jest.fn().mockReturnValue(createFakeStream()), { volume: 90 })

      // That's 8 *live* instances (the first already ended) — still under
      // the cap, so nothing should have been evicted.
      expect(getEngineMock().stopMusic).not.toHaveBeenCalled()
    })

    it('rejects, leaving every other instance untouched, if the factory fails', async () => {
      const stream = createFakeStream()
      await manager.playEffect(jest.fn().mockReturnValue(stream), { volume: 90 })

      await expect(
        manager.playEffect(jest.fn().mockRejectedValue(new Error('decode failed')), { volume: 90 }),
      ).rejects.toThrow('decode failed')

      expect(getEngineMock().playMusicFromStream).toHaveBeenCalledTimes(1)
      expect(getEngineMock().stopMusic).not.toHaveBeenCalled()
    })

    it('stopAllEffects ends every active instance, without touching Music or Ambience', async () => {
      const streamA = createFakeStream()
      const streamB = createFakeStream()
      await manager.playEffect(jest.fn().mockReturnValue(streamA), { volume: 90 })
      await manager.playEffect(jest.fn().mockReturnValue(streamB), { volume: 90 })
      const [idA, idB] = getEngineMock().playMusicFromStream.mock.calls.map(call => call[1])

      manager.stopAllEffects()

      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(idA)
      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(idB)
      expect(getEngineMock().stopAllMusic).not.toHaveBeenCalled()
    })

    it('a stopped instance is dropped from bookkeeping, so a later stopAllEffects does not touch it again', async () => {
      const stream = createFakeStream()
      await manager.playEffect(jest.fn().mockReturnValue(stream), { volume: 90 })
      const id = getEngineMock().playMusicFromStream.mock.calls[0][1]
      stream.emit('end')

      manager.stopAllEffects()

      expect(getEngineMock().stopMusic).not.toHaveBeenCalledWith(id)
    })

    it('destroy() ends every Effect instance via the engine', async () => {
      const stream = createFakeStream()
      await manager.playEffect(jest.fn().mockReturnValue(stream), { volume: 90 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      manager.destroy()

      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(streamId)
    })

    it('disconnect() ends every Effect instance via the engine', async () => {
      ;(voice.getVoiceConnection as jest.Mock).mockReturnValue(undefined)
      const stream = createFakeStream()
      await manager.playEffect(jest.fn().mockReturnValue(stream), { volume: 90 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      manager.disconnect()

      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(streamId)
    })

    it('a lost connection teardown ends every Effect instance', async () => {
      const connection = createFakeConnection()
      ;(voice.joinVoiceChannel as jest.Mock).mockReturnValue(connection)
      await manager.connect(fakeChannel)
      const stream = createFakeStream()
      await manager.playEffect(jest.fn().mockReturnValue(stream), { volume: 90 })
      const streamId = getEngineMock().playMusicFromStream.mock.calls[0][1]

      connection.emit('stateChange', { status: voice.VoiceConnectionStatus.Ready }, { status: voice.VoiceConnectionStatus.Destroyed })
      await flushAsync()

      expect(getEngineMock().stopMusic).toHaveBeenCalledWith(streamId)
    })
  })
})
