import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchDiscordConfig,
  fetchStoragePath,
  listBookmarks,
  openFileDialog,
  saveBookmarks,
  saveFileDialog,
  selectFolder,
  selectStorageFolder,
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

  it('selectStorageFolder invokes dialog:selectFolder', async () => {
    mockInvoke.mockResolvedValue('/selected/path')
    const result = await selectStorageFolder()
    expect(mockInvoke).toHaveBeenCalledWith('dialog:selectFolder', { title: 'Select storage folder' })
    expect(result).toBe('/selected/path')
  })

  it('selectFolder invokes dialog:selectFolder with custom title', async () => {
    mockInvoke.mockResolvedValue('/custom/path')
    const result = await selectFolder('Pick a dir')
    expect(mockInvoke).toHaveBeenCalledWith('dialog:selectFolder', { title: 'Pick a dir' })
    expect(result).toBe('/custom/path')
  })

  it('selectFolder uses default title', async () => {
    mockInvoke.mockResolvedValue(null)
    await selectFolder()
    expect(mockInvoke).toHaveBeenCalledWith('dialog:selectFolder', { title: 'Select folder' })
  })

  it('saveFileDialog invokes dialog:saveFile', async () => {
    mockInvoke.mockResolvedValue('/save/path.zip')
    const opts = { title: 'Save', defaultPath: 'file.zip', filters: [{ name: 'ZIP', extensions: ['zip'] }] }
    const result = await saveFileDialog(opts)
    expect(mockInvoke).toHaveBeenCalledWith('dialog:saveFile', opts)
    expect(result).toBe('/save/path.zip')
  })

  it('saveFileDialog uses empty options by default', async () => {
    mockInvoke.mockResolvedValue(null)
    await saveFileDialog()
    expect(mockInvoke).toHaveBeenCalledWith('dialog:saveFile', {})
  })

  it('openFileDialog invokes dialog:openFile', async () => {
    mockInvoke.mockResolvedValue('/open/file.mp3')
    const opts = { title: 'Open', filters: [{ name: 'Audio', extensions: ['mp3'] }] }
    const result = await openFileDialog(opts)
    expect(mockInvoke).toHaveBeenCalledWith('dialog:openFile', opts)
    expect(result).toBe('/open/file.mp3')
  })

  it('openFileDialog uses empty options by default', async () => {
    mockInvoke.mockResolvedValue(null)
    await openFileDialog()
    expect(mockInvoke).toHaveBeenCalledWith('dialog:openFile', {})
  })

  it('listBookmarks uses apiCall', async () => {
    const bookmarks = [{ name: 'Test', url: 'https://example.com' }]
    mockInvoke.mockResolvedValue(bookmarks)
    const result = await listBookmarks()
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'config',
      method: 'getBookmarks',
      args: [],
    })
    expect(result).toEqual(bookmarks)
  })

  it('saveBookmarks uses apiCall', async () => {
    mockInvoke.mockResolvedValue(undefined)
    const bookmarks = [{ name: 'Test', url: 'https://example.com' }]
    await saveBookmarks(bookmarks)
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'config',
      method: 'setBookmarks',
      args: [bookmarks],
    })
  })

  it('throws when not in Electron', () => {
    delete (window as any).hibiki
    expect(() => fetchDiscordConfig()).toThrow('Electron app')
  })

  it('selectStorageFolder throws when not in Electron', async () => {
    delete (window as any).hibiki
    await expect(selectStorageFolder()).rejects.toThrow('Electron app')
  })
})
