import { Readable } from 'node:stream'
import { AudioEngine } from './audio-engine'
import { MIXER_PACKET_BYTES } from './mixer-feed'

function pcm(packets: number, value: number): Readable {
  const buf = Buffer.alloc(MIXER_PACKET_BYTES * packets)
  for (let i = 0; i < buf.length; i += 2)
    buf.writeInt16LE(value, i)
  return Readable.from([buf])
}

describe('audioEngine with a Local sink', () => {
  let engine: AudioEngine
  afterEach(() => {
    engine?.destroy()
    jest.useRealTimers()
  })

  it('starts the sink with the first stream, delivers its audio in packets, and stops it after the idle grace', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
    })
    const sink = {
      start: jest.fn(),
      write: jest.fn(),
      stop: jest.fn(),
    }
    engine = new AudioEngine({ localSink: sink })
    expect(engine.isIdle).toBe(true)

    const onEnded = jest.fn()
    engine.playMusicFromStream(pcm(10, 1000), 'm', 100, onEnded)
    expect(sink.start).toHaveBeenCalledTimes(1)
    expect(engine.isIdle).toBe(false)

    for (let i = 0; i < 30; i++) {
      await jest.advanceTimersByTimeAsync(20)
    }
    const packets = sink.write.mock.calls.map(c => c[0] as Buffer)
    expect(packets.every(p => p.length === MIXER_PACKET_BYTES)).toBe(true)
    expect(packets.some(p => p.readInt16LE(0) !== 0)).toBe(true)
    expect(onEnded).toHaveBeenCalled()

    expect(sink.stop).not.toHaveBeenCalled()
    await jest.advanceTimersByTimeAsync(11_000)
    expect(sink.stop).toHaveBeenCalledTimes(1)
    expect(engine.isIdle).toBe(true)
  })

  it('stopLocalSink cuts the streams and the sink', () => {
    const sink = {
      start: jest.fn(),
      write: jest.fn(),
      stop: jest.fn(),
    }
    engine = new AudioEngine({ localSink: sink })
    engine.playMusicFromStream(new Readable({
      read() {},
    }), 'm')
    engine.stopLocalSink()
    expect(sink.stop).toHaveBeenCalledTimes(1)
    expect(engine.isIdle).toBe(true)
  })

  it('has no voice player', () => {
    engine = new AudioEngine({
      localSink: {
        start: jest.fn(),
        write: jest.fn(),
        stop: jest.fn(),
      },
    })
    expect(() => engine.audioPlayer).toThrow()
  })
})
