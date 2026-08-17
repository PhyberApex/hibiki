import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFlashSet } from './useFlashSet'

describe('useFlashSet', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks an id as flashing for the configured duration', () => {
    const flash = useFlashSet(500)
    expect(flash.has('a')).toBe(false)
    flash.trigger('a')
    expect(flash.has('a')).toBe(true)
    vi.advanceTimersByTime(499)
    expect(flash.has('a')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(flash.has('a')).toBe(false)
  })

  it('tracks ids independently', () => {
    const flash = useFlashSet(500)
    flash.trigger('a')
    vi.advanceTimersByTime(300)
    flash.trigger('b')
    vi.advanceTimersByTime(200)
    expect(flash.has('a')).toBe(false)
    expect(flash.has('b')).toBe(true)
  })

  it('extends the flash when re-triggered while active', () => {
    const flash = useFlashSet(500)
    flash.trigger('a')
    vi.advanceTimersByTime(400)
    flash.trigger('a')
    vi.advanceTimersByTime(400)
    expect(flash.has('a')).toBe(true)
    vi.advanceTimersByTime(100)
    expect(flash.has('a')).toBe(false)
  })
})
