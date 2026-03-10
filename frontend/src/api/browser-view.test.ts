import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  browserViewGoBack,
  browserViewGoForward,
  browserViewReload,
  createBrowserView,
  destroyBrowserView,
  getBrowserViewMediaSourceId,
  hideBrowserView,
  loadBrowserViewURL,
  onBrowserViewEvent,
  setBrowserViewBounds,
  showBrowserView,
} from './browser-view'

describe('browser-view API', () => {
  const mockInvoke = vi.fn()
  const mockOn = vi.fn()

  beforeEach(() => {
    ;(window as any).hibiki = { invoke: mockInvoke, on: mockOn }
  })
  afterEach(() => {
    delete (window as any).hibiki
  })

  it('createBrowserView invokes browserView:create', async () => {
    mockInvoke.mockResolvedValue(1)
    const result = await createBrowserView('https://example.com')
    expect(mockInvoke).toHaveBeenCalledWith('browserView:create', { url: 'https://example.com' })
    expect(result).toBe(1)
  })

  it('destroyBrowserView invokes browserView:destroy', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await destroyBrowserView(1)
    expect(mockInvoke).toHaveBeenCalledWith('browserView:destroy', { id: 1 })
  })

  it('setBrowserViewBounds invokes browserView:setBounds', async () => {
    mockInvoke.mockResolvedValue(undefined)
    const bounds = { x: 0, y: 0, width: 800, height: 600 }
    await setBrowserViewBounds(1, bounds)
    expect(mockInvoke).toHaveBeenCalledWith('browserView:setBounds', { id: 1, bounds })
  })

  it('loadBrowserViewURL invokes browserView:loadURL', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await loadBrowserViewURL(1, 'https://example.com')
    expect(mockInvoke).toHaveBeenCalledWith('browserView:loadURL', { id: 1, url: 'https://example.com' })
  })

  it('browserViewGoBack invokes browserView:goBack', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await browserViewGoBack(1)
    expect(mockInvoke).toHaveBeenCalledWith('browserView:goBack', { id: 1 })
  })

  it('browserViewGoForward invokes browserView:goForward', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await browserViewGoForward(1)
    expect(mockInvoke).toHaveBeenCalledWith('browserView:goForward', { id: 1 })
  })

  it('browserViewReload invokes browserView:reload', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await browserViewReload(1)
    expect(mockInvoke).toHaveBeenCalledWith('browserView:reload', { id: 1 })
  })

  it('getBrowserViewMediaSourceId invokes browserView:getMediaSourceId', async () => {
    mockInvoke.mockResolvedValue('source-123')
    const result = await getBrowserViewMediaSourceId(1)
    expect(mockInvoke).toHaveBeenCalledWith('browserView:getMediaSourceId', { id: 1 })
    expect(result).toBe('source-123')
  })

  it('showBrowserView invokes browserView:show', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await showBrowserView(1)
    expect(mockInvoke).toHaveBeenCalledWith('browserView:show', { id: 1 })
  })

  it('hideBrowserView invokes browserView:hide', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await hideBrowserView(1)
    expect(mockInvoke).toHaveBeenCalledWith('browserView:hide', { id: 1 })
  })

  it('onBrowserViewEvent registers listener and returns cleanup', () => {
    const cleanup = vi.fn()
    mockOn.mockReturnValue(cleanup)
    const cb = vi.fn()
    const unsubscribe = onBrowserViewEvent('browserView:navigated', cb)
    expect(mockOn).toHaveBeenCalledWith('browserView:navigated', cb)
    expect(unsubscribe).toBe(cleanup)
  })

  it('onBrowserViewEvent returns noop when hibiki.on is not available', () => {
    delete (window as any).hibiki
    const cb = vi.fn()
    const unsubscribe = onBrowserViewEvent('browserView:navigated', cb)
    expect(typeof unsubscribe).toBe('function')
    unsubscribe() // should not throw
  })

  it('createBrowserView throws when not in Electron', () => {
    delete (window as any).hibiki
    expect(() => createBrowserView('https://example.com')).toThrow('Electron app')
  })
})
