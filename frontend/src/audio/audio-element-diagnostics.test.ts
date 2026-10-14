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

  it('watchAudioElement logs errors and stalls, attaching only once', () => {
    const el = watchAudioElement(new Audio())
    watchAudioElement(el)

    el.dispatchEvent(new Event('stalled'))
    el.dispatchEvent(new Event('error'))

    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledTimes(1)
  })
})
