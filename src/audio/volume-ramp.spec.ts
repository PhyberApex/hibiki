import { rampVolume } from './volume-ramp'

describe('rampVolume', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('ramps linearly from `from` to `to` over the duration', () => {
    const onVolume = jest.fn()
    rampVolume({ from: 0, to: 100, durationMs: 1000, onVolume })

    jest.advanceTimersByTime(500)
    expect(onVolume).toHaveBeenLastCalledWith(50)

    jest.advanceTimersByTime(500)
    expect(onVolume).toHaveBeenLastCalledWith(100)
  })

  it('calls onDone exactly once when the ramp reaches its target', () => {
    const onDone = jest.fn()
    rampVolume({ from: 100, to: 0, durationMs: 200, onVolume: () => {}, onDone })

    jest.advanceTimersByTime(200)
    expect(onDone).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(200)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('treats a duration of 0 as an immediate cut — onVolume(to) and onDone fire synchronously', () => {
    const onVolume = jest.fn()
    const onDone = jest.fn()
    rampVolume({ from: 80, to: 0, durationMs: 0, onVolume, onDone })

    expect(onVolume).toHaveBeenCalledWith(0)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('still lands exactly on target after a single throttled tick that covers the whole duration', () => {
    const onVolume = jest.fn()
    const onDone = jest.fn()
    rampVolume({ from: 0, to: 100, durationMs: 100, onVolume, onDone })

    jest.advanceTimersByTime(5000)
    expect(onVolume).toHaveBeenLastCalledWith(100)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('cancel() stops the ramp without calling onVolume or onDone again', () => {
    const onVolume = jest.fn()
    const onDone = jest.fn()
    const handle = rampVolume({ from: 100, to: 0, durationMs: 1000, onVolume, onDone })

    jest.advanceTimersByTime(100)
    onVolume.mockClear()

    handle.cancel()
    jest.advanceTimersByTime(1000)

    expect(onVolume).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })
})
