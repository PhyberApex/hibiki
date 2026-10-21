import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchHotkeyStatus, onHotkeyFired } from './hotkeys'

describe('hotkeys API', () => {
  const mockInvoke = vi.fn()
  const off = vi.fn()
  let fired: ((payload: unknown) => void) | undefined
  const mockOn = vi.fn((_channel: string, callback: (payload: unknown) => void) => {
    fired = callback
    return off
  })

  beforeEach(() => {
    fired = undefined
    ;(window as any).hibiki = { invoke: mockInvoke, on: mockOn }
  })
  afterEach(() => {
    delete (window as any).hibiki
    vi.clearAllMocks()
  })

  it('fetchHotkeyStatus reads hotkeys:getStatus', async () => {
    const status = { enabled: true, registered: ['F13'], failures: [{ accelerator: 'F14', owner: 'scene:storm', reason: 'taken' }] }
    mockInvoke.mockResolvedValue(status)
    await expect(fetchHotkeyStatus()).resolves.toEqual(status)
    expect(mockInvoke).toHaveBeenCalledWith('hotkeys:getStatus')
  })

  it('fetchHotkeyStatus propagates a rejected invoke', async () => {
    mockInvoke.mockRejectedValue(new Error('main gone'))
    await expect(fetchHotkeyStatus()).rejects.toThrow('main gone')
  })

  it('fetchHotkeyStatus throws outside Electron', () => {
    delete (window as any).hibiki
    expect(() => fetchHotkeyStatus()).toThrow('Electron API not available')
  })

  it('onHotkeyFired subscribes to hotkey:fired and passes the accelerator on', () => {
    const callback = vi.fn()
    onHotkeyFired(callback)
    expect(mockOn).toHaveBeenCalledWith('hotkey:fired', expect.any(Function))
    fired?.({ accelerator: 'Ctrl+F13' })
    expect(callback).toHaveBeenCalledExactlyOnceWith('Ctrl+F13')
  })

  it('onHotkeyFired ignores payloads without a string accelerator', () => {
    const callback = vi.fn()
    onHotkeyFired(callback)
    fired?.(undefined)
    fired?.({})
    fired?.({ accelerator: 13 })
    expect(callback).not.toHaveBeenCalled()
  })

  it('onHotkeyFired returns the bridge unsubscribe', () => {
    const unsubscribe = onHotkeyFired(vi.fn())
    unsubscribe()
    expect(off).toHaveBeenCalledOnce()
  })

  it('onHotkeyFired is a no-op outside Electron', () => {
    delete (window as any).hibiki
    const unsubscribe = onHotkeyFired(vi.fn())
    expect(() => unsubscribe()).not.toThrow()
    expect(mockOn).not.toHaveBeenCalled()
  })
})
