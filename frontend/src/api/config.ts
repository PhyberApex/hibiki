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

export type VisionProviderId = 'claude' | 'openai-compatible'

export interface VisionProviderStatus {
  keyConfigured: boolean
  configured: boolean
}

export interface VisionOpenAICompatibleStatus extends VisionProviderStatus {
  baseUrl: string
  model: string
}

export interface VisionConfig {
  provider: VisionProviderId
  enabled: boolean
  /** Gate for the currently selected provider — mirrors `claude.configured` or `openaiCompatible.configured`. */
  configured: boolean
  claude: VisionProviderStatus
  openaiCompatible: VisionOpenAICompatibleStatus
}

export interface StorageWarning {
  file: string
  backupPath: string
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

export function updateVisionProvider(provider: VisionProviderId): Promise<VisionConfig> {
  requireElectron()
  return apiCall<VisionConfig>('config', 'setVisionProvider', [provider])
}

export function updateVisionApiKey(provider: VisionProviderId, apiKey: string): Promise<VisionConfig> {
  requireElectron()
  return apiCall<VisionConfig>('config', 'setVisionApiKey', [provider, apiKey])
}

export function updateVisionOpenAiBaseUrl(baseUrl: string): Promise<VisionConfig> {
  requireElectron()
  return apiCall<VisionConfig>('config', 'setVisionOpenAiBaseUrl', [baseUrl])
}

export function updateVisionOpenAiModel(model: string): Promise<VisionConfig> {
  requireElectron()
  return apiCall<VisionConfig>('config', 'setVisionOpenAiModel', [model])
}

export function updateVisionEnabled(enabled: boolean): Promise<VisionConfig> {
  requireElectron()
  return apiCall<VisionConfig>('config', 'setVisionEnabled', [enabled])
}

export function fetchStorageWarnings(): Promise<StorageWarning[]> {
  requireElectron()
  return apiCall<StorageWarning[]>('config', 'getStorageWarnings', [])
}
