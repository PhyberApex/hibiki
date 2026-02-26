import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchDiscordConfig,
  fetchStoragePath,
  updateDiscordToken,
  updateStoragePath,
} from './config'

describe('config API', () => {
  const mockInvoke = vi.fn()

  beforeEach(() => {
    ;(window as any).hibiki = { invoke: mockInvoke }
  })
  afterEach(() => {
    delete (window as any).hibiki
  })

  it('fetchDiscordConfig uses apiCall', async () => {
    mockInvoke.mockResolvedValue({ tokenConfigured: true })
    const result = await fetchDiscordConfig()
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'config',
      method: 'getDiscord',
      args: [],
    })
    expect(result).toEqual({ tokenConfigured: true })
  })

  it('updateDiscordToken uses apiCall', async () => {
    mockInvoke.mockResolvedValue({ tokenConfigured: true })
    await updateDiscordToken('token123')
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'config',
      method: 'setDiscordToken',
      args: ['token123'],
    })
  })

  it('fetchStoragePath uses apiCall', async () => {
    mockInvoke.mockResolvedValue({ path: '/custom/storage' })
    const result = await fetchStoragePath()
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'config',
      method: 'getStoragePath',
      args: [],
    })
    expect(result).toEqual({ path: '/custom/storage' })
  })

  it('updateStoragePath uses apiCall', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await updateStoragePath('/path/to/storage')
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'config',
      method: 'setStoragePath',
      args: ['/path/to/storage'],
    })
  })

  it('throws when not in Electron', () => {
    delete (window as any).hibiki
    expect(() => fetchDiscordConfig()).toThrow('Electron app')
  })
})
