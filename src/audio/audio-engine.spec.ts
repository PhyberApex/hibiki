import type { Readable } from 'node:stream'
import { once } from 'node:events'
import { PassThrough } from 'node:stream'
import { AudioEngine } from './audio-engine'

interface FakeInput {
  destroy: jest.Mock
  write: jest.Mock
  end: jest.Mock
  dataSize: number
  params?: { volume?: number, forceClose?: boolean }
}

const createdInputs: FakeInput[] = []

const playerListeners = new Map<string, (...args: unknown[]) => void>()
const fakePlayer = {
  play: jest.fn(),
  stop: jest.fn(),
  on: jest.fn((event: string, listener: (...args: unknown[]) => void) => {
    playerListeners.set(event, listener)
  }),
}

jest.mock('@discordjs/voice', () => ({
  AudioPlayerStatus: { Idle: 'idle', Playing: 'playing' },
  createAudioPlayer: jest.fn(() => fakePlayer),
  createAudioResource: jest.fn(() => ({})),
  NoSubscriberBehavior: { Pause: 'pause' },
  StreamType: { Raw: 'raw' },
}))

jest.mock('node-audio-mixer', () => ({
  AudioMixer: jest.fn().mockImplementation(() => ({
    pipe: jest.fn(),
    unpipe: jest.fn(),
    destroy: jest.fn(),
    createAudioInput: jest.fn().mockImplementation((params: { volume?: number }) => {
      const input: FakeInput = {
        destroy: jest.fn(),
        write: jest.fn(),
        end: jest.fn(),
        dataSize: 0,
        params: { volume: params.volume },
      }
      createdInputs.push(input)
      return input
    }),
  })),
}))

function createFakeStream(): Readable {
  return new PassThrough()
}

/** Ends `stream` and waits for the engine to observe it (the feed consumes the stream asynchronously). */
async function endStream(stream: Readable): Promise<void> {
  const ended = once(stream, 'end')
  ;(stream as PassThrough).end()
  await ended
}

describe('audioEngine', () => {
  let engine: AudioEngine

  beforeEach(() => {
    jest.clearAllMocks()
    createdInputs.length = 0
    playerListeners.clear()
    engine = new AudioEngine()
  })

  describe('voice player liveness', () => {
    const flush = () => new Promise(resolve => setImmediate(resolve))

    it('leaves silence to the voice player: no mixer-generated silence, no missed-frame limit', async () => {
      const { AudioMixer } = await import('node-audio-mixer')
      const { createAudioPlayer } = await import('@discordjs/voice')

      expect(AudioMixer).toHaveBeenCalledWith(expect.objectContaining({ generateSilence: false }))
      expect(createAudioPlayer).toHaveBeenCalledWith({
        behaviors: expect.objectContaining({ maxMissedFrames: Number.POSITIVE_INFINITY }),
      })
    })

    it('primes each mixer output with one frame of silence so the player starts playing right away', async () => {
      const { createAudioResource } = await import('@discordjs/voice')
      const output = (createAudioResource as jest.Mock).mock.calls[0][0] as import('node:stream').PassThrough

      expect(output.readableLength).toBe(3840)
    })

    it('reattaches a fresh mixer output and plays again when the player goes idle', async () => {
      const { createAudioResource } = await import('@discordjs/voice')
      expect(fakePlayer.play).toHaveBeenCalledTimes(1)

      playerListeners.get('stateChange')!({ status: 'playing' }, { status: 'idle' })
      await flush()

      expect(createAudioResource).toHaveBeenCalledTimes(2)
      expect(fakePlayer.play).toHaveBeenCalledTimes(2)
    })

    it('does not restart playback after destroy()', async () => {
      engine.destroy()

      playerListeners.get('stateChange')!({ status: 'playing' }, { status: 'idle' })
      await flush()

      expect(fakePlayer.play).toHaveBeenCalledTimes(1)
    })
  })

  describe('initial volume and live volume control', () => {
    it('spawns the input at the given initial volume instead of the master music volume', () => {
      const stream = createFakeStream()

      engine.playMusicFromStream(stream, 'a', 0)

      expect(createdInputs[0].params?.volume).toBe(0)
    })

    it('setStreamVolume updates the input live via params', () => {
      const stream = createFakeStream()
      engine.playMusicFromStream(stream, 'a', 50)

      engine.setStreamVolume('a', 80)

      expect(createdInputs[0].params?.volume).toBe(80)
    })

    it('setStreamVolume is a no-op for an id with no active stream', () => {
      expect(() => engine.setStreamVolume('missing', 50)).not.toThrow()
    })

    it('rampStreamVolume ramps the input volume over time and calls onDone', () => {
      jest.useFakeTimers()
      try {
        const stream = createFakeStream()
        engine.playMusicFromStream(stream, 'a', 0)
        const onDone = jest.fn()

        engine.rampStreamVolume('a', 100, 1000, onDone)

        jest.advanceTimersByTime(500)
        expect(createdInputs[0].params?.volume).toBe(50)
        expect(onDone).not.toHaveBeenCalled()

        jest.advanceTimersByTime(500)
        expect(createdInputs[0].params?.volume).toBe(100)
        expect(onDone).toHaveBeenCalledTimes(1)
      }
      finally {
        jest.useRealTimers()
      }
    })

    it('rampStreamVolume with a duration of 0 sets the volume immediately and calls onDone synchronously', () => {
      const stream = createFakeStream()
      engine.playMusicFromStream(stream, 'a', 50)
      const onDone = jest.fn()

      engine.rampStreamVolume('a', 0, 0, onDone)

      expect(createdInputs[0].params?.volume).toBe(0)
      expect(onDone).toHaveBeenCalledTimes(1)
    })

    it('a later ramp cancels an in-progress one on the same stream', () => {
      jest.useFakeTimers()
      try {
        const stream = createFakeStream()
        engine.playMusicFromStream(stream, 'a', 0)
        const firstDone = jest.fn()
        const secondDone = jest.fn()

        engine.rampStreamVolume('a', 100, 1000, firstDone)
        jest.advanceTimersByTime(200)
        engine.rampStreamVolume('a', 0, 200, secondDone)
        jest.advanceTimersByTime(200)

        expect(createdInputs[0].params?.volume).toBe(0)
        expect(firstDone).not.toHaveBeenCalled()
        expect(secondDone).toHaveBeenCalledTimes(1)
      }
      finally {
        jest.useRealTimers()
      }
    })

    it('stopping a stream cancels its in-progress ramp', () => {
      jest.useFakeTimers()
      try {
        const stream = createFakeStream()
        engine.playMusicFromStream(stream, 'a', 0)
        const onDone = jest.fn()

        engine.rampStreamVolume('a', 100, 1000, onDone)
        engine.stopMusic('a')
        jest.advanceTimersByTime(1000)

        expect(onDone).not.toHaveBeenCalled()
      }
      finally {
        jest.useRealTimers()
      }
    })

    it('a stream draining naturally cancels its in-progress ramp (#642)', async () => {
      jest.useFakeTimers()
      try {
        const stream = createFakeStream()
        const onEnded = jest.fn()
        engine.playMusicFromStream(stream, 'a', 0, onEnded)
        const onDone = jest.fn()

        engine.rampStreamVolume('a', 100, 1000, onDone)
        await endStream(stream)
        jest.advanceTimersByTime(50)
        expect(onEnded).toHaveBeenCalledTimes(1)

        const paramsAtDrain = createdInputs[0].params
        jest.advanceTimersByTime(1000)

        expect(createdInputs[0].params).toBe(paramsAtDrain)
        expect(onDone).not.toHaveBeenCalled()
      }
      finally {
        jest.useRealTimers()
      }
    })
  })

  describe('keyed effect streams', () => {
    it('opens a keyed effect stream at the given volume and sets it live afterwards', () => {
      engine.playEffectFromStream(createFakeStream(), 'browser-1', 40)
      expect(createdInputs[0].params.volume).toBe(40)

      engine.setEffectStreamVolume('browser-1', 65)
      expect(createdInputs[0].params).toEqual({ volume: 65 })

      engine.setEffectStreamVolume('browser-1', 150)
      expect(createdInputs[0].params).toEqual({ volume: 100 })
    })

    it('falls back to the effects default volume without an explicit one', () => {
      engine.playEffectFromStream(createFakeStream())
      expect(createdInputs[0].params.volume).toBe(90)
    })

    it('ignores a volume change for an unknown or drained effect stream', async () => {
      const stream = createFakeStream()
      engine.playEffectFromStream(stream, 'browser-1', 40)
      engine.setEffectStreamVolume('nope', 10)
      expect(createdInputs[0].params).toEqual({ volume: 40 })

      await endStream(stream)
      await new Promise(resolve => setTimeout(resolve, 50))
      engine.setEffectStreamVolume('browser-1', 10)
      expect(createdInputs[0].params).toEqual({ volume: 40 })
    })

    it('a restart under the same id takes the id over, so the old stream draining does not drop the new one', async () => {
      const first = createFakeStream()
      engine.playEffectFromStream(first, 'browser-1', 40)
      engine.playEffectFromStream(createFakeStream(), 'browser-1', 50)

      await endStream(first)
      await new Promise(resolve => setTimeout(resolve, 50))
      engine.setEffectStreamVolume('browser-1', 70)

      expect(createdInputs[0].params).toEqual({ volume: 40 })
      expect(createdInputs[1].params).toEqual({ volume: 70 })
    })
  })

  describe('playMusicFromStream with stream ids', () => {
    it('mixes two different-id music streams at the same time', () => {
      const streamA = createFakeStream()
      const streamB = createFakeStream()

      engine.playMusicFromStream(streamA, 'a')
      engine.playMusicFromStream(streamB, 'b')

      expect(createdInputs).toHaveLength(2)
      expect(createdInputs[0].destroy).not.toHaveBeenCalled()
      expect(createdInputs[1].destroy).not.toHaveBeenCalled()
    })

    it('stopping one id leaves the other playing', () => {
      const streamA = createFakeStream()
      const streamB = createFakeStream()
      engine.playMusicFromStream(streamA, 'a')
      engine.playMusicFromStream(streamB, 'b')

      engine.stopMusic('a')

      expect(createdInputs[0].destroy).toHaveBeenCalledTimes(1)
      expect(createdInputs[1].destroy).not.toHaveBeenCalled()
    })

    it('replaces the default-id stream on start without an id, same as before', () => {
      const first = createFakeStream()
      const second = createFakeStream()

      engine.playMusicFromStream(first)
      engine.playMusicFromStream(second)

      expect(createdInputs).toHaveLength(2)
      expect(createdInputs[0].destroy).toHaveBeenCalledTimes(1)
      expect(createdInputs[1].destroy).not.toHaveBeenCalled()
    })

    it('stopMusic() without an id ends only the default-id stream, not other ids', () => {
      const named = createFakeStream()
      const defaultStream = createFakeStream()
      engine.playMusicFromStream(named, 'named')
      engine.playMusicFromStream(defaultStream)

      engine.stopMusic()

      expect(createdInputs[0].destroy).not.toHaveBeenCalled()
      expect(createdInputs[1].destroy).toHaveBeenCalledTimes(1)
    })

    it('removes an ended stream on its own without affecting others', async () => {
      const streamA = createFakeStream()
      const streamB = createFakeStream()
      const onEnded = jest.fn()
      engine.playMusicFromStream(streamA, 'a', 80, onEnded)
      engine.playMusicFromStream(streamB, 'b')

      await endStream(streamA)

      expect(createdInputs[0].end).toHaveBeenCalledTimes(1)
      expect(createdInputs[0].destroy).toHaveBeenCalledTimes(1)
      expect(onEnded).toHaveBeenCalledTimes(1)
      expect(createdInputs[1].destroy).not.toHaveBeenCalled()

      // Stopping the already-ended id again must not throw or double-destroy.
      expect(() => engine.stopMusic('a')).not.toThrow()
      expect(createdInputs[0].destroy).toHaveBeenCalledTimes(1)
    })

    it('reports onEnded only once the mixer input has drained, not when the source ends', async () => {
      jest.useFakeTimers()
      try {
        const stream = createFakeStream()
        const onEnded = jest.fn()
        engine.playMusicFromStream(stream, 'a', 80, onEnded)
        createdInputs[0].dataSize = 3840

        const ended = once(stream, 'end')
        ;(stream as PassThrough).end()
        await ended

        expect(createdInputs[0].end).toHaveBeenCalledTimes(1)
        expect(onEnded).not.toHaveBeenCalled()

        createdInputs[0].dataSize = 0
        jest.advanceTimersByTime(50)

        expect(onEnded).toHaveBeenCalledTimes(1)
      }
      finally {
        jest.useRealTimers()
      }
    })

    it('removes an errored stream on its own without affecting others', () => {
      const streamA = createFakeStream()
      const streamB = createFakeStream()
      const onEnded = jest.fn()
      engine.playMusicFromStream(streamA, 'a', 80, onEnded)
      engine.playMusicFromStream(streamB, 'b')

      streamA.emit('error', new Error('boom'))

      expect(createdInputs[0].destroy).toHaveBeenCalledTimes(1)
      expect(onEnded).toHaveBeenCalledTimes(1)
      expect(createdInputs[1].destroy).not.toHaveBeenCalled()
    })

    it('does not report onEnded for a stream that was stopped', async () => {
      const stream = createFakeStream()
      const onEnded = jest.fn()
      engine.playMusicFromStream(stream, 'a', 80, onEnded)

      engine.stopMusic('a')
      stream.emit('end')
      await new Promise(resolve => setImmediate(resolve))

      expect(onEnded).not.toHaveBeenCalled()
      expect(createdInputs[0].params?.forceClose).toBe(true)
    })

    it('does not report onEnded for a stream replaced under the same id', async () => {
      const first = createFakeStream()
      const second = createFakeStream()
      const onEnded = jest.fn()
      engine.playMusicFromStream(first, 'a', 80, onEnded)
      engine.playMusicFromStream(second, 'a')

      first.emit('end')
      await endStream(second)

      expect(onEnded).not.toHaveBeenCalled()
      expect(createdInputs[1].destroy).toHaveBeenCalledTimes(1)
    })

    it('a stream started again under the same id after a stop plays fresh and reports its own onEnded', async () => {
      const first = createFakeStream()
      const second = createFakeStream()
      const firstEnded = jest.fn()
      const secondEnded = jest.fn()
      engine.playMusicFromStream(first, 'a', 80, firstEnded)
      engine.stopMusic('a')

      engine.playMusicFromStream(second, 'a', 60, secondEnded)
      ;(second as PassThrough).write(Buffer.alloc(3840))
      await endStream(second)

      expect(createdInputs).toHaveLength(2)
      expect(createdInputs[1].params?.volume).toBe(60)
      expect(createdInputs[1].write).toHaveBeenCalledTimes(1)
      expect(firstEnded).not.toHaveBeenCalled()
      expect(secondEnded).toHaveBeenCalledTimes(1)
    })

    it('hands PCM to the mixer input through the feed', async () => {
      const stream = createFakeStream()
      engine.playMusicFromStream(stream, 'a')

      ;(stream as PassThrough).write(Buffer.alloc(3840))
      await endStream(stream)

      expect(createdInputs[0].write).toHaveBeenCalledTimes(1)
      expect((createdInputs[0].write.mock.calls[0][0] as Buffer).length).toBe(3840)
    })

    it('stopAllMusic ends every music stream', () => {
      const streamA = createFakeStream()
      const streamB = createFakeStream()
      engine.playMusicFromStream(streamA, 'a')
      engine.playMusicFromStream(streamB, 'b')

      engine.stopAllMusic()

      expect(createdInputs[0].destroy).toHaveBeenCalledTimes(1)
      expect(createdInputs[1].destroy).toHaveBeenCalledTimes(1)
    })

    it('stopAllMusic leaves effect streams playing', () => {
      const music = createFakeStream()
      const effect = createFakeStream()
      engine.playMusicFromStream(music, 'a')
      engine.playEffectFromStream(effect, 'browser-1')

      engine.stopAllMusic()

      expect(createdInputs[0].destroy).toHaveBeenCalledTimes(1)
      expect(createdInputs[1].destroy).not.toHaveBeenCalled()
    })

    it('destroy() cleans up every music stream and every effect stream', () => {
      const music = createFakeStream()
      const effect = createFakeStream()
      engine.playMusicFromStream(music, 'a')
      engine.playEffectFromStream(effect)

      engine.destroy()

      expect(createdInputs[0].destroy).toHaveBeenCalledTimes(1)
      expect(createdInputs[1].destroy).toHaveBeenCalledTimes(1)
    })
  })
})
