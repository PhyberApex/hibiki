import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import router from '../router'
import { bindUsageStatsRouter, fetchUsageStats, markUsageStatsPrompted, trackUsage, updateUsageStatsEnabled } from './usage-stats'

describe('usage stats API', () => {
  const mockInvoke = vi.fn()

  beforeEach(() => {
    ;(window as any).hibiki = { invoke: mockInvoke }
  })
  afterEach(() => {
    delete (window as any).hibiki
    mockInvoke.mockReset()
  })

  it.each([
    ['fetchUsageStats', () => fetchUsageStats(), 'getUsageStats', []],
    ['updateUsageStatsEnabled', () => updateUsageStatsEnabled(true), 'setUsageStatsEnabled', [true]],
    ['markUsageStatsPrompted', () => markUsageStatsPrompted(), 'markUsageStatsPrompted', []],
  ])('%s calls config.%s', async (_name, call, method, args) => {
    mockInvoke.mockResolvedValue({ enabled: false, prompted: false })
    await (call as () => Promise<unknown>)()
    expect(mockInvoke).toHaveBeenCalledWith('api', { domain: 'config', method, args })
  })

  it('tracks with the route pattern, not the concrete path', async () => {
    mockInvoke.mockResolvedValue(undefined)
    bindUsageStatsRouter(router)
    await router.push('/scenes/2f7c-scene-id')
    trackUsage({ name: 'target-switch', data: { target: 'local' } })
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'usageStats',
      method: 'track',
      args: [{ name: 'target-switch', data: { target: 'local' }, url: '/scenes/:id' }],
    })
  })

  it('never throws when the backend rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockInvoke.mockRejectedValue(new Error('gone'))
    expect(() => trackUsage({ name: 'hotkey-fired', data: { kind: 'scene' } })).not.toThrow()
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    warn.mockRestore()
  })

  it('is a no-op outside Electron', () => {
    delete (window as any).hibiki
    expect(() => trackUsage({ name: 'hotkey-fired', data: { kind: 'scene' } })).not.toThrow()
  })
})
