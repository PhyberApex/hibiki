import { apiCall, useElectronApi } from './electron'

export interface DiscordConfig {
  tokenConfigured: boolean
}

export interface StorageConfig {
  path: string | null
}

export interface AccessibilitySettings {
  luminancePulses: boolean
  /** `null` follows the OS `prefers-reduced-motion` setting. */
  reduceMotion: boolean | null
}

export interface VisionConfig {
  apiKeyConfigured: boolean
  enabled: boolean
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

export function fetchAccessibilitySettings(): Promise<AccessibilitySettings> {
  requireElectron()
  return apiCall<AccessibilitySettings>('config', 'getAccessibility', [])
}

export function updateAccessibilitySettings(settings: AccessibilitySettings): Promise<void> {
  requireElectron()
  return apiCall<void>('config', 'setAccessibility', [settings])
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

export function fetchVisionConfig(): Promise<VisionConfig> {
  requireElectron()
  return apiCall<VisionConfig>('config', 'getVision', [])
}

export function updateVisionApiKey(apiKey: string): Promise<VisionConfig> {
  requireElectron()
  return apiCall<VisionConfig>('config', 'setVisionApiKey', [apiKey])
}

export function updateVisionEnabled(enabled: boolean): Promise<VisionConfig> {
  requireElectron()
  return apiCall<VisionConfig>('config', 'setVisionEnabled', [enabled])
}
