import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteScene,
  exportScene,
  getScene,
  importScene,
  listScenes,
  saveScene,
} from './scenes'

describe('scenes API', () => {
  const mockInvoke = vi.fn()

  beforeEach(() => {
    ;(window as any).hibiki = { invoke: mockInvoke }
  })
  afterEach(() => {
    delete (window as any).hibiki
  })

  it('listScenes uses apiCall', async () => {
    mockInvoke.mockResolvedValue([])
    await listScenes()
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'scenes',
      method: 'list',
      args: [],
    })
  })

  it('getScene uses apiCall', async () => {
    mockInvoke.mockResolvedValue({ id: 'x', name: 'test' })
    await getScene('x')
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'scenes',
      method: 'get',
      args: ['x'],
    })
  })

  it('saveScene uses apiCall', async () => {
    mockInvoke.mockResolvedValue({ id: 'x', name: 'New' })
    await saveScene({ name: 'New' })
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'scenes',
      method: 'save',
      args: [{ name: 'New' }],
    })
  })

  it('deleteScene uses apiCall', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await deleteScene('x')
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'scenes',
      method: 'remove',
      args: ['x'],
    })
  })

  it('exportScene uses apiCall', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await exportScene('x', '/out')
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'scenes',
      method: 'exportScene',
      args: ['x', '/out'],
    })
  })

  it('importScene uses apiCall', async () => {
    mockInvoke.mockResolvedValue({ id: 'y', name: 'Imported' })
    await importScene('/source')
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'scenes',
      method: 'importScene',
      args: ['/source'],
    })
  })

  it('throws when not in Electron', () => {
    delete (window as any).hibiki
    expect(() => listScenes()).toThrow('Electron app')
  })
})
