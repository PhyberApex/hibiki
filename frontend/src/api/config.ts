import { apiCall, useElectronApi } from './electron'

export interface DiscordConfig {
  tokenConfigured: boolean
}

export interface StorageConfig {
  path: string | null
}

function requireElectron(): void {
  if (!useElectronApi())
    throw new Error('Hibiki runs as an Electron app. Open it via pnpm run electron.')
}

export function fetchDiscordConfig(): Promise<DiscordConfig> {
  requireElectron()
  return apiCall('config', 'getDiscord', [])
}

export function updateDiscordToken(token: string): Promise<DiscordConfig> {
  requireElectron()
  return apiCall('config', 'setDiscordToken', [token])
}

export function fetchStoragePath(): Promise<StorageConfig> {
  requireElectron()
  return apiCall<StorageConfig>('config', 'getStoragePath', [])
}

export function updateStoragePath(path: string): Promise<void> {
  requireElectron()
  return apiCall<void>('config', 'setStoragePath', [path])
}

export async function selectStorageFolder(): Promise<string | null> {
  if (!useElectronApi())
    throw new Error('Hibiki runs as an Electron app.')
  return window.hibiki!.invoke('dialog:selectFolder', { title: 'Select storage folder' }) as Promise<string | null>
}

export async function selectFolder(title?: string): Promise<string | null> {
  if (!useElectronApi())
    throw new Error('Hibiki runs as an Electron app.')
  return window.hibiki!.invoke('dialog:selectFolder', { title: title ?? 'Select folder' }) as Promise<string | null>
}

export async function saveFileDialog(options?: {
  title?: string
  defaultPath?: string
  filters?: { name: string, extensions: string[] }[]
}): Promise<string | null> {
  if (!useElectronApi())
    throw new Error('Hibiki runs as an Electron app.')
  return window.hibiki!.invoke('dialog:saveFile', options ?? {}) as Promise<string | null>
}

export async function openFileDialog(options?: {
  title?: string
  filters?: { name: string, extensions: string[] }[]
}): Promise<string | null> {
  if (!useElectronApi())
    throw new Error('Hibiki runs as an Electron app.')
  return window.hibiki!.invoke('dialog:openFile', options ?? {}) as Promise<string | null>
}

export interface Bookmark {
  name: string
  url: string
  favicon?: string
}

export function listBookmarks(): Promise<Bookmark[]> {
  requireElectron()
  return apiCall<Bookmark[]>('config', 'getBookmarks', [])
}

export function saveBookmarks(bookmarks: Bookmark[]): Promise<void> {
  requireElectron()
  return apiCall<void>('config', 'setBookmarks', [bookmarks])
}
