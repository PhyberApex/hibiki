import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useAccessibilityStore } from './accessibility'

vi.mock('@/api/config', () => ({
  fetchAccessibilitySettings: vi.fn().mockResolvedValue({ luminancePulses: true, reduceMotion: null }),
  updateAccessibilitySettings: vi.fn().mockResolvedValue(undefined),
}))

type MediaListener = (event: { matches: boolean }) => void

function stubMatchMedia(matches: boolean) {
  const listeners: MediaListener[] = []
  const mql = {
    matches,
    addEventListener: vi.fn((_: string, cb: MediaListener) => listeners.push(cb)),
    removeEventListener: vi.fn(),
  }
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia
  return {
    mql,
    fire(next: boolean) {
      mql.matches = next
      listeners.forEach(cb => cb({ matches: next }))
    },
  }
}

describe('accessibility store', () => {
  let fetchAccessibilitySettings: ReturnType<typeof vi.fn>
  let updateAccessibilitySettings: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    setActivePinia(createPinia())
    const api = await import('@/api/config')
    fetchAccessibilitySettings = vi.mocked(api.fetchAccessibilitySettings)
    updateAccessibilitySettings = vi.mocked(api.updateAccessibilitySettings)
    vi.clearAllMocks()
    document.documentElement.className = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('defaults to pulses on and reduce motion following the OS', () => {
    stubMatchMedia(false)
    const store = useAccessibilityStore()
    expect(store.luminancePulses).toBe(true)
    expect(store.reduceMotionOverride).toBeNull()
    expect(store.followsSystemMotion).toBe(true)
    expect(store.reduceMotion).toBe(false)
  })

  it('reads the OS prefers-reduced-motion value and tracks changes', () => {
    const media = stubMatchMedia(true)
    const store = useAccessibilityStore()
    expect(store.reduceMotion).toBe(true)
    media.fire(false)
    expect(store.reduceMotion).toBe(false)
  })

  it('works without matchMedia support', () => {
    const store = useAccessibilityStore()
    expect(store.reduceMotion).toBe(false)
  })

  it('lets the user override reduce motion in either direction', async () => {
    const media = stubMatchMedia(true)
    const store = useAccessibilityStore()
    await store.setReduceMotion(false)
    expect(store.reduceMotion).toBe(false)
    expect(store.followsSystemMotion).toBe(false)
    expect(updateAccessibilitySettings).toHaveBeenLastCalledWith({ luminancePulses: true, reduceMotion: false })

    media.fire(false)
    await store.setReduceMotion(true)
    expect(store.reduceMotion).toBe(true)
    expect(updateAccessibilitySettings).toHaveBeenLastCalledWith({ luminancePulses: true, reduceMotion: true })

    await store.setReduceMotion(null)
    expect(store.followsSystemMotion).toBe(true)
    expect(store.reduceMotion).toBe(false)
    expect(updateAccessibilitySettings).toHaveBeenLastCalledWith({ luminancePulses: true, reduceMotion: null })
  })

  it('persists the luminance pulse toggle', async () => {
    stubMatchMedia(false)
    const store = useAccessibilityStore()
    await store.setLuminancePulses(false)
    expect(store.luminancePulses).toBe(false)
    expect(updateAccessibilitySettings).toHaveBeenCalledWith({ luminancePulses: false, reduceMotion: null })
  })

  it('loads persisted settings', async () => {
    stubMatchMedia(false)
    fetchAccessibilitySettings.mockResolvedValueOnce({ luminancePulses: false, reduceMotion: true })
    const store = useAccessibilityStore()
    await store.load()
    expect(store.luminancePulses).toBe(false)
    expect(store.reduceMotionOverride).toBe(true)
    expect(store.reduceMotion).toBe(true)
  })

  it('keeps defaults when loading fails', async () => {
    stubMatchMedia(false)
    fetchAccessibilitySettings.mockRejectedValueOnce(new Error('no electron'))
    const store = useAccessibilityStore()
    await store.load()
    expect(store.luminancePulses).toBe(true)
    expect(store.reduceMotionOverride).toBeNull()
  })

  it('mirrors effective state onto the document root as classes', async () => {
    const media = stubMatchMedia(false)
    const store = useAccessibilityStore()
    await nextTick()
    const root = document.documentElement.classList
    expect(root.contains('pulses-off')).toBe(false)
    expect(root.contains('reduce-motion')).toBe(false)

    await store.setLuminancePulses(false)
    await nextTick()
    expect(root.contains('pulses-off')).toBe(true)

    media.fire(true)
    await nextTick()
    expect(root.contains('reduce-motion')).toBe(true)

    await store.setReduceMotion(false)
    await nextTick()
    expect(root.contains('reduce-motion')).toBe(false)
    expect(root.contains('allow-motion')).toBe(true)

    await store.setReduceMotion(null)
    await nextTick()
    expect(root.contains('allow-motion')).toBe(false)
    expect(root.contains('reduce-motion')).toBe(true)
  })
})
