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

jest.mock('@discordjs/voice', () => ({
  createAudioPlayer: jest.fn().mockReturnValue({ play: jest.fn(), on: jest.fn(), stop: jest.fn() }),
  createAudioResource: jest.fn().mockReturnValue({}),
  NoSubscriberBehavior: { Pause: 'pause' },
  StreamType: { Raw: 'raw' },
}))

jest.mock('node-audio-mixer', () => ({
  AudioMixer: jest.fn().mockImplementation(() => ({
    pipe: jest.fn(),
    destroy: jest.fn(),
    createAudioInput: jest.fn().mockImplementation((params: { volume?: number }) => {
      const input: FakeInput = { destroy: jest.fn(), write: jest.fn(), end: jest.fn(), dataSize: 0, params: { volume: params.volume } }
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
    engine = new AudioEngine()
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
