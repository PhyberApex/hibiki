import { afterEach, describe, expect, it } from 'vitest'
import { apiCall, useElectronApi } from './electron'

describe('electron API', () => {
  afterEach(() => {
    delete (window as any).hibiki
  })

  it('useElectronApi returns false when hibiki not set', () => {
    expect(useElectronApi()).toBe(false)
  })

  it('apiCall throws when hibiki not available', () => {
    expect(() => apiCall('x', 'y', [])).toThrow('Electron API not available')
  })
})
