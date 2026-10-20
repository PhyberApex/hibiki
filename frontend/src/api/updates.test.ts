import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkForUpdate, dismissUpdate, fetchUpdateCheckSettings, updateUpdateCheckEnabled } from './updates'

describe('updates API', () => {
  const mockInvoke = vi.fn()

  beforeEach(() => {
    ;(window as any).hibiki = { invoke: mockInvoke }
  })
  afterEach(() => {
    delete (window as any).hibiki
    mockInvoke.mockReset()
  })

  it.each([
    ['fetchUpdateCheckSettings', () => fetchUpdateCheckSettings(), 'getSettings', []],
    ['updateUpdateCheckEnabled', () => updateUpdateCheckEnabled(false), 'setEnabled', [false]],
    ['checkForUpdate', () => checkForUpdate(), 'check', []],
    ['dismissUpdate', () => dismissUpdate('1.7.0'), 'dismiss', ['1.7.0']],
  ])('%s calls updates.%s', async (_name, call, method, args) => {
    mockInvoke.mockResolvedValue(undefined)
    await (call as () => Promise<unknown>)()
    expect(mockInvoke).toHaveBeenCalledWith('api', { domain: 'updates', method, args })
  })

  it('throws outside Electron', () => {
    delete (window as any).hibiki
    expect(() => checkForUpdate()).toThrow('Electron API not available')
  })
})
