import { afterEach, describe, expect, it } from 'vitest'
import { apiCall, getPathForFile, useElectronApi } from './electron'

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

  it('getPathForFile returns null when the bridge is missing', () => {
    expect(getPathForFile(new File(['x'], 'map.png'))).toBeNull()
  })

  it('getPathForFile delegates to the bridge', () => {
    const file = new File(['x'], 'map.png')
    ;(window as any).hibiki = { getPathForFile: (f: File) => `/abs/${f.name}` }
    expect(getPathForFile(file)).toBe('/abs/map.png')
  })
})
