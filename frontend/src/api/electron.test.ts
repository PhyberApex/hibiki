import { afterEach, describe, expect, it } from 'vitest'
import { apiCall, getPathForFile, unwrapIpcError, useElectronApi } from './electron'

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

  it('apiCall rethrows the backend message without Electron\'s IPC wrapper', async () => {
    ;(window as any).hibiki = {
      invoke: () => Promise.reject(new Error('Error invoking remote method \'api\': Error: Hotkey F13 is already used by Scene "Tavern"')),
    }
    await expect(apiCall('scenes', 'save', [])).rejects.toThrow('Hotkey F13 is already used by Scene "Tavern"')
    await expect(apiCall('scenes', 'save', [])).rejects.not.toThrow('invoking remote method')
  })

  it('unwrapIpcError leaves errors without the wrapper untouched', () => {
    const plain = new Error('boom')
    expect(unwrapIpcError(plain)).toBe(plain)
    expect(unwrapIpcError('string')).toBe('string')
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
