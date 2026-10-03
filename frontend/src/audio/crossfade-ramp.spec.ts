import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CrossfadeRamp } from './crossfade-ramp'

describe('crossfadeRamp', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ramps linearly from `from` to `to` over the duration', () => {
    const ramp = new CrossfadeRamp()
    const onVolume = vi.fn()
    ramp.fade('a', { direction: 'in', from: 0, to: 1, durationMs: 1000, onVolume })

    vi.advanceTimersByTime(500)
    expect(onVolume).toHaveBeenLastCalledWith(0.5)

    vi.advanceTimersByTime(500)
    expect(onVolume).toHaveBeenLastCalledWith(1)
  })

  it('calls onDone exactly once when the ramp reaches its target', () => {
    const ramp = new CrossfadeRamp()
    const onDone = vi.fn()
    ramp.fade('a', { direction: 'out', from: 1, to: 0, durationMs: 200, onVolume: () => {}, onDone })

    vi.advanceTimersByTime(200)
    expect(onDone).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(200)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('treats a duration of 0 as an immediate cut — onVolume(to) and onDone fire synchronously', () => {
    const ramp = new CrossfadeRamp()
    const onVolume = vi.fn()
    const onDone = vi.fn()
    ramp.fade('a', { direction: 'out', from: 0.8, to: 0, durationMs: 0, onVolume, onDone })

    expect(onVolume).toHaveBeenCalledWith(0)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('still lands exactly on target after a single throttled tick that covers the whole duration', () => {
    // Simulates a backgrounded/throttled timer: no ticks fire until well past
    // the fade's end, but elapsed-time tracking still resolves to `to`.
    const ramp = new CrossfadeRamp()
    const onVolume = vi.fn()
    const onDone = vi.fn()
    ramp.fade('a', { direction: 'in', from: 0, to: 1, durationMs: 100, onVolume, onDone })

    vi.advanceTimersByTime(5000)
    expect(onVolume).toHaveBeenLastCalledWith(1)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('does not redirect a fade already heading out back toward in', () => {
    const ramp = new CrossfadeRamp()
    const outVolume = vi.fn()
    ramp.fade('a', { direction: 'out', from: 1, to: 0, durationMs: 1000, onVolume: outVolume })

    const inVolume = vi.fn()
    ramp.fade('a', { direction: 'in', from: 0.5, to: 1, durationMs: 1000, onVolume: inVolume })

    vi.advanceTimersByTime(1000)
    expect(inVolume).not.toHaveBeenCalled()
    expect(outVolume).toHaveBeenLastCalledWith(0)
    expect(ramp.directionOf('a')).toBeNull()
  })

  it('retargets an in-progress fade toward a new target starting from the given `from`', () => {
    const ramp = new CrossfadeRamp()
    const onVolume = vi.fn()
    ramp.fade('a', { direction: 'in', from: 0, to: 1, durationMs: 1000, onVolume })
    vi.advanceTimersByTime(500)
    expect(onVolume).toHaveBeenLastCalledWith(0.5)

    // A second Scene switch retargets mid-fade, starting fresh from the
    // caller-supplied current volume toward the newest target.
    ramp.fade('a', { direction: 'in', from: 0.5, to: 0.2, durationMs: 1000, onVolume })
    vi.advanceTimersByTime(1000)
    expect(onVolume).toHaveBeenLastCalledWith(0.2)
  })

  it('allows switching an in-progress "in" fade over to "out"', () => {
    const ramp = new CrossfadeRamp()
    const onVolume = vi.fn()
    ramp.fade('a', { direction: 'in', from: 0, to: 1, durationMs: 1000, onVolume })
    vi.advanceTimersByTime(300)

    ramp.fade('a', { direction: 'out', from: 0.3, to: 0, durationMs: 500, onVolume })
    vi.advanceTimersByTime(500)
    expect(onVolume).toHaveBeenLastCalledWith(0)
  })

  it('tracks multiple independent keys concurrently', () => {
    const ramp = new CrossfadeRamp()
    const volumeA = vi.fn()
    const volumeB = vi.fn()
    ramp.fade('a', { direction: 'out', from: 1, to: 0, durationMs: 1000, onVolume: volumeA })
    ramp.fade('b', { direction: 'in', from: 0, to: 1, durationMs: 1000, onVolume: volumeB })

    vi.advanceTimersByTime(1000)
    expect(volumeA).toHaveBeenLastCalledWith(0)
    expect(volumeB).toHaveBeenLastCalledWith(1)
  })

  it('cancel() stops a specific fade without calling onVolume or onDone again', () => {
    const ramp = new CrossfadeRamp()
    const onVolume = vi.fn()
    const onDone = vi.fn()
    ramp.fade('a', { direction: 'out', from: 1, to: 0, durationMs: 1000, onVolume, onDone })
    vi.advanceTimersByTime(100)
    onVolume.mockClear()

    ramp.cancel('a')
    vi.advanceTimersByTime(1000)

    expect(onVolume).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('cancelAll() stops every in-progress fade', () => {
    const ramp = new CrossfadeRamp()
    const volumeA = vi.fn()
    const volumeB = vi.fn()
    ramp.fade('a', { direction: 'out', from: 1, to: 0, durationMs: 1000, onVolume: volumeA })
    ramp.fade('b', { direction: 'in', from: 0, to: 1, durationMs: 1000, onVolume: volumeB })
    vi.advanceTimersByTime(100)
    volumeA.mockClear()
    volumeB.mockClear()

    ramp.cancelAll()
    vi.advanceTimersByTime(1000)

    expect(volumeA).not.toHaveBeenCalled()
    expect(volumeB).not.toHaveBeenCalled()
  })
})
