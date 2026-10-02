import type { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { AudioEngine } from './audio-engine'

const createdInputs: { destroy: jest.Mock }[] = []

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
    createAudioInput: jest.fn().mockImplementation(() => {
      const input = { destroy: jest.fn() }
      createdInputs.push(input)
      return input
    }),
  })),
}))

function createFakeStream(): Readable {
  const stream = new EventEmitter() as unknown as Readable
  ;(stream as unknown as { pipe: jest.Mock }).pipe = jest.fn()
  ;(stream as unknown as { destroy: jest.Mock }).destroy = jest.fn()
  return stream
}

describe('audioEngine', () => {
  let engine: AudioEngine

  beforeEach(() => {
    jest.clearAllMocks()
    createdInputs.length = 0
    engine = new AudioEngine()
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

    it('removes an ended stream on its own without affecting others', () => {
      const streamA = createFakeStream()
      const streamB = createFakeStream()
      engine.playMusicFromStream(streamA, 'a')
      engine.playMusicFromStream(streamB, 'b')

      streamA.emit('end')

      expect(createdInputs[0].destroy).toHaveBeenCalledTimes(1)
      expect(createdInputs[1].destroy).not.toHaveBeenCalled()

      // Stopping the already-ended id again must not throw or double-destroy.
      expect(() => engine.stopMusic('a')).not.toThrow()
      expect(createdInputs[0].destroy).toHaveBeenCalledTimes(1)
    })

    it('removes an errored stream on its own without affecting others', () => {
      const streamA = createFakeStream()
      const streamB = createFakeStream()
      engine.playMusicFromStream(streamA, 'a')
      engine.playMusicFromStream(streamB, 'b')

      streamA.emit('error', new Error('boom'))

      expect(createdInputs[0].destroy).toHaveBeenCalledTimes(1)
      expect(createdInputs[1].destroy).not.toHaveBeenCalled()
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
