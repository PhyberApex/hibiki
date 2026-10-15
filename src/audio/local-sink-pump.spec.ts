import { PassThrough } from 'node:stream'
import { LocalSinkPump } from './local-sink-pump'
import { MIXER_PACKET_BYTES } from './mixer-feed'

function setup() {
  const source = new PassThrough()
  const sink = { start: jest.fn(), write: jest.fn(), stop: jest.fn() }
  const onFailure = jest.fn()
  return { source, sink, onFailure, pump: new LocalSinkPump(source, sink, onFailure) }
}

describe('localSinkPump', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('starts the sink and sends one packet per 20 ms, not as fast as the mixer produces', () => {
    const { source, sink, pump } = setup()
    for (let i = 0; i < 50; i++)
      source.write(Buffer.alloc(MIXER_PACKET_BYTES, 1))
    pump.start()
    expect(sink.start).toHaveBeenCalledTimes(1)
    // start() discards stale data, so only silence flows here
    jest.advanceTimersByTime(100)
    expect(sink.write.mock.calls.length).toBeGreaterThanOrEqual(5)
    expect(sink.write.mock.calls.length).toBeLessThanOrEqual(6)
    pump.stop()
  })

  it('sends mixer packets, and silence when the mixer is empty', () => {
    const { source, sink, pump } = setup()
    pump.start()
    sink.write.mockClear()
    source.write(Buffer.alloc(MIXER_PACKET_BYTES, 7))
    jest.advanceTimersByTime(20)
    jest.advanceTimersByTime(20)
    const packets = sink.write.mock.calls.map(c => c[0] as Buffer)
    expect(packets.some(p => p[0] === 7)).toBe(true)
    expect(packets.some(p => p.every(b => b === 0))).toBe(true)
    expect(packets.every(p => p.length === MIXER_PACKET_BYTES)).toBe(true)
    pump.stop()
  })

  it('stops the sink once and ignores repeated start/stop', () => {
    const { sink, pump } = setup()
    pump.start()
    pump.start()
    expect(sink.start).toHaveBeenCalledTimes(1)
    pump.stop()
    pump.stop()
    expect(sink.stop).toHaveBeenCalledTimes(1)
    const writes = sink.write.mock.calls.length
    jest.advanceTimersByTime(100)
    expect(sink.write.mock.calls.length).toBe(writes)
    expect(pump.running).toBe(false)
  })

  it('resyncs instead of bursting after a long stall', () => {
    const { sink, pump } = setup()
    pump.start()
    sink.write.mockClear()
    jest.setSystemTime(Date.now() + 5000)
    jest.advanceTimersByTime(10)
    expect(sink.write.mock.calls.length).toBeLessThanOrEqual(2)
    pump.stop()
  })

  it('stops and reports when a write throws', () => {
    const { sink, onFailure, pump } = setup()
    sink.write.mockImplementation(() => {
      throw new Error('no renderer')
    })
    pump.start()
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(pump.running).toBe(false)
  })

  it('reports a sink that fails to start', () => {
    const { sink, onFailure, pump } = setup()
    sink.start.mockImplementation(() => {
      throw new Error('boom')
    })
    pump.start()
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(pump.running).toBe(false)
  })
})
