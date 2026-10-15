import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_VISIBLE_TOASTS, useToastStore } from './toast'

describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('queues toasts in order', () => {
    const store = useToastStore()
    store.show({ type: 'success', text: 'one' })
    store.show({ type: 'error', text: 'two' })
    expect(store.toasts.map(t => t.text)).toEqual(['one', 'two'])
  })

  it('keeps at most MAX_VISIBLE_TOASTS, dropping the oldest', () => {
    const store = useToastStore()
    for (let i = 0; i < MAX_VISIBLE_TOASTS + 2; i++)
      store.show({ type: 'success', text: `t${i}` })
    expect(store.toasts).toHaveLength(MAX_VISIBLE_TOASTS)
    expect(store.toasts[0].text).toBe('t2')
  })

  it('auto-dismisses after the default duration', () => {
    const store = useToastStore()
    store.show({ type: 'success', text: 'bye' })
    vi.advanceTimersByTime(3999)
    expect(store.toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(store.toasts).toHaveLength(0)
  })

  it('honours durationMs', () => {
    const store = useToastStore()
    store.show({ type: 'success', text: 'long', durationMs: 10000 })
    vi.advanceTimersByTime(9999)
    expect(store.toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(store.toasts).toHaveLength(0)
  })

  it('dismisses manually and only that toast', () => {
    const store = useToastStore()
    const a = store.show({ type: 'success', text: 'a' })
    store.show({ type: 'success', text: 'b' })
    store.dismiss(a)
    expect(store.toasts.map(t => t.text)).toEqual(['b'])
  })

  it('logs warnings and errors with a [toast] prefix, not successes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = useToastStore()
    store.show({ type: 'success', text: 'fine' })
    store.show({ type: 'warning', text: 'careful' })
    store.show({ type: 'error', text: 'broken' })
    expect(warn).toHaveBeenCalledWith('[toast] careful')
    expect(error).toHaveBeenCalledWith('[toast] broken')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
  })
})
