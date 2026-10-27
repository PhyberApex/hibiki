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

  it('replaces a toast with the same key in place and restarts its timer', () => {
    const store = useToastStore()
    const first = store.show({ type: 'info', text: 'Master volume 65%', key: 'vol' })
    store.show({ type: 'success', text: 'other' })
    vi.advanceTimersByTime(3000)
    const second = store.show({ type: 'info', text: 'Master volume 70%', key: 'vol' })
    expect(second).toBe(first)
    expect(store.toasts.map(t => t.text)).toEqual(['Master volume 70%', 'other'])
    vi.advanceTimersByTime(3999)
    expect(store.toasts.map(t => t.text)).toContain('Master volume 70%')
    vi.advanceTimersByTime(1)
    expect(store.toasts.map(t => t.text)).not.toContain('Master volume 70%')
  })

  it('keeps a sticky toast (durationMs: null) until dismissed', () => {
    const store = useToastStore()
    const id = store.show({ type: 'info', text: 'Hibiki 1.7.0 is available', durationMs: null })
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(store.toasts).toHaveLength(1)
    store.dismiss(id)
    expect(store.toasts).toHaveLength(0)
  })

  it('carries a link for the toast to render', () => {
    const store = useToastStore()
    store.show({
      type: 'info',
      text: 'update',
      link: { label: 'View release', url: 'https://github.com/x' },
    })
    expect(store.toasts[0].link).toEqual({ label: 'View release', url: 'https://github.com/x' })
  })

  it('calls onDismiss only when the GM dismisses the toast, not on timeout or eviction', () => {
    const store = useToastStore()
    const onDismiss = vi.fn()
    store.show({ type: 'info', text: 'timed', onDismiss })
    vi.advanceTimersByTime(4000)
    store.show({ type: 'info', text: 'evicted', onDismiss })
    for (let i = 0; i < MAX_VISIBLE_TOASTS; i++)
      store.show({ type: 'success', text: `t${i}` })
    expect(store.toasts.map(t => t.text)).not.toContain('evicted')
    expect(onDismiss).not.toHaveBeenCalled()
    store.toasts.slice().forEach(t => store.dismiss(t.id))

    const id = store.show({
      type: 'info',
      text: 'by hand',
      durationMs: null,
      onDismiss,
    })
    store.dismissByUser(id)
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(store.toasts.map(t => t.text)).not.toContain('by hand')
  })

  it('keeps a sticky toast when newer timed toasts need room', () => {
    const store = useToastStore()
    store.show({ type: 'info', text: 'sticky', durationMs: null })
    for (let i = 0; i < MAX_VISIBLE_TOASTS + 1; i++)
      store.show({ type: 'success', text: `t${i}` })
    expect(store.toasts).toHaveLength(MAX_VISIBLE_TOASTS)
    expect(store.toasts.map(t => t.text)).toEqual(['sticky', 't2', 't3'])
  })
})
