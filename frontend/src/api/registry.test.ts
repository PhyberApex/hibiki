import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRegistryIndex, installFromRegistry } from './registry'

describe('registry API', () => {
  const mockInvoke = vi.fn()

  beforeEach(() => {
    ;(window as any).hibiki = { invoke: mockInvoke }
  })
  afterEach(() => {
    delete (window as any).hibiki
  })

  it('getRegistryIndex uses apiCall', async () => {
    mockInvoke.mockResolvedValue({ version: 1, updatedAt: '', scenes: [] })
    await getRegistryIndex(true)
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'registry',
      method: 'getIndex',
      args: [true],
    })
  })

  it('getRegistryIndex passes undefined when no forceRefresh', async () => {
    mockInvoke.mockResolvedValue({ version: 1, updatedAt: '', scenes: [] })
    await getRegistryIndex()
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'registry',
      method: 'getIndex',
      args: [undefined],
    })
  })

  it('installFromRegistry uses apiCall', async () => {
    mockInvoke.mockResolvedValue({ id: 'x', name: 'test' })
    await installFromRegistry('dark-tavern')
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'registry',
      method: 'installFromRegistry',
      args: ['dark-tavern'],
    })
  })

  it('throws when not in Electron', () => {
    delete (window as any).hibiki
    expect(() => getRegistryIndex()).toThrow('Electron app')
  })
})
