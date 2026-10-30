import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitForPlayable, watchAudioElement } from './audio-element-diagnostics'

describe('audio element diagnostics', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('resolves and logs when the element becomes playable', async () => {
    const el = new Audio()
    const pending = waitForPlayable(el, 'music test')

    el.dispatchEvent(new Event('canplaythrough'))

    await expect(pending).resolves.toBeUndefined()
    // eslint-disable-next-line no-console
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('[audio] music test playable after'))
  })

  it('warns when the element has not become playable after five seconds', () => {
    const el = new Audio()
    void waitForPlayable(el, 'effect test').catch(() => {})

    vi.advanceTimersByTime(5_000)

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[audio] effect test still not playable after 5000 ms'))
  })

  it('rejects on a media error and skips the warning', async () => {
    const el = new Audio()
    const pending = waitForPlayable(el, 'music test')

    el.dispatchEvent(new Event('error'))
    await expect(pending).rejects.toBeDefined()
    vi.advanceTimersByTime(5_000)

    expect(console.warn).not.toHaveBeenCalled()
  })

  it('an error after the element became playable neither logs nor rejects', async () => {
    const el = new Audio()
    const pending = waitForPlayable(el, 'music test')
    el.dispatchEvent(new Event('canplaythrough'))
    await expect(pending).resolves.toBeUndefined()

    el.dispatchEvent(new Event('error'))
    vi.advanceTimersByTime(5_000)

    await expect(pending).resolves.toBeUndefined()
    expect(console.warn).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('a later load on a reused element is not reported by an earlier failed wait', async () => {
    const el = new Audio()
    const failed = waitForPlayable(el, 'first load')
    el.dispatchEvent(new Event('error'))
    await expect(failed).rejects.toBeDefined()

    el.dispatchEvent(new Event('canplaythrough'))

    // eslint-disable-next-line no-console
    expect(console.info).not.toHaveBeenCalledWith(expect.stringContaining('first load'))
  })

  it('removes both listeners once settled, so a reused element does not accumulate them', async () => {
    const el = new Audio()
    const add = vi.spyOn(el, 'addEventListener')
    const remove = vi.spyOn(el, 'removeEventListener')

    for (let i = 0; i < 3; i++) {
      const pending = waitForPlayable(el, `load ${i}`)
      el.dispatchEvent(new Event(i % 2
        ? 'error'
        : 'canplaythrough'))
      await pending.catch(() => {})
    }

    const added = add.mock.calls.map(([type, listener]) => [type, listener])
    const removed = remove.mock.calls.map(([type, listener]) => [type, listener])
    expect(added).toHaveLength(6)
    expect(removed).toEqual(expect.arrayContaining(added))
  })

  it('watchAudioElement logs errors and stalls, attaching only once', () => {
    const el = watchAudioElement(new Audio())
    watchAudioElement(el)

    el.dispatchEvent(new Event('stalled'))
    el.dispatchEvent(new Event('error'))

    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledTimes(1)
  })
})
