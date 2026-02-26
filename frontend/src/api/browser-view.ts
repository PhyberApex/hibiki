import { useElectronApi } from './electron'

function requireElectron(): void {
  if (!useElectronApi())
    throw new Error('Hibiki runs as an Electron app. Open it via pnpm run electron.')
}

export function createBrowserView(url: string): Promise<number> {
  requireElectron()
  return window.hibiki!.invoke('browserView:create', { url }) as Promise<number>
}

export function destroyBrowserView(id: number): Promise<void> {
  requireElectron()
  return window.hibiki!.invoke('browserView:destroy', { id }) as Promise<void>
}

export function setBrowserViewBounds(id: number, bounds: { x: number, y: number, width: number, height: number }): Promise<void> {
  requireElectron()
  return window.hibiki!.invoke('browserView:setBounds', { id, bounds }) as Promise<void>
}

export function loadBrowserViewURL(id: number, url: string): Promise<void> {
  requireElectron()
  return window.hibiki!.invoke('browserView:loadURL', { id, url }) as Promise<void>
}

export function browserViewGoBack(id: number): Promise<void> {
  requireElectron()
  return window.hibiki!.invoke('browserView:goBack', { id }) as Promise<void>
}

export function browserViewGoForward(id: number): Promise<void> {
  requireElectron()
  return window.hibiki!.invoke('browserView:goForward', { id }) as Promise<void>
}

export function browserViewReload(id: number): Promise<void> {
  requireElectron()
  return window.hibiki!.invoke('browserView:reload', { id }) as Promise<void>
}

export function getBrowserViewMediaSourceId(id: number): Promise<string> {
  requireElectron()
  return window.hibiki!.invoke('browserView:getMediaSourceId', { id }) as Promise<string>
}

export function showBrowserView(id: number): Promise<void> {
  requireElectron()
  return window.hibiki!.invoke('browserView:show', { id }) as Promise<void>
}

export function hideBrowserView(id: number): Promise<void> {
  requireElectron()
  return window.hibiki!.invoke('browserView:hide', { id }) as Promise<void>
}

export type BrowserViewEventCallback = (...args: unknown[]) => void

export function onBrowserViewEvent(event: string, callback: BrowserViewEventCallback): () => void {
  if (!window.hibiki?.on)
    return () => {}
  return window.hibiki.on(event, callback)
}
