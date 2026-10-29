import { apiCall, useElectronApi } from './electron'

export interface DiscordConfig {
  tokenConfigured: boolean
  /** False when this system can't encrypt secrets at rest (e.g. Linux without a keyring) — the token is stored as plain text. */
  encrypted: boolean
  /** The token comes from the DISCORD_TOKEN environment variable, which the app cannot remove. */
  fromEnvironment?: boolean
}

export interface StorageConfig {
  path: string | null
}

export interface AccessibilitySettings {
  luminancePulses: boolean
  /** `null` follows the OS `prefers-reduced-motion` setting. */
  reduceMotion: boolean | null
}

export const SCENE_FADE_LENGTH_MIN_SECONDS = 0
export const SCENE_FADE_LENGTH_MAX_SECONDS = 10
export const SCENE_FADE_LENGTH_STEP_SECONDS = 0.5

export type VisionProviderId = 'claude' | 'openai-compatible'

export interface VisionProviderStatus {
  keyConfigured: boolean
  configured: boolean
  /** False when this system can't encrypt secrets at rest — a stored key for this provider is plain text. */
  encrypted: boolean
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

/** Removes the stored token: the bot goes offline, voice ends and Local becomes active if Discord was. */
export function clearDiscordToken(): Promise<DiscordConfig> {
  requireElectron()
  return apiCall('config', 'clearDiscordToken', [])
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

export function fetchSceneFadeLength(): Promise<number> {
  requireElectron()
  return apiCall<number>('config', 'getSceneFadeLength', [])
}

export function updateSceneFadeLength(seconds: number): Promise<void> {
  requireElectron()
  return apiCall<void>('config', 'setSceneFadeLength', [seconds])
}

export interface HotkeySettings {
  /** "Enable global hotkeys": false hands every key back to the OS without unbinding. */
  enabled: boolean
  /** Action Hotkeys (CONTEXT.md): one fixed app action each, unique against every other Hotkey. */
  stopHotkey?: string
  stopEffectsHotkey?: string
  previousSceneHotkey?: string
  nextSceneHotkey?: string
  volumeDownHotkey?: string
  volumeUpHotkey?: string
}

export function fetchHotkeySettings(): Promise<HotkeySettings> {
  requireElectron()
  return apiCall<HotkeySettings>('config', 'getHotkeySettings', [])
}

/** Rejects with a message naming the current owner when the Hotkey is already bound. */
export function updateHotkeySettings(settings: HotkeySettings): Promise<void> {
  requireElectron()
  return apiCall<void>('config', 'setHotkeySettings', [settings])
}

export type OutputTargetKind = 'discord' | 'local'

/** The reserved Output Target id for the Local Target; any other id is a Discord guild id. */
export const LOCAL_TARGET_ID = 'local'

export function fetchActiveOutputTarget(): Promise<OutputTargetKind> {
  requireElectron()
  return apiCall<OutputTargetKind>('config', 'getActiveOutputTarget', [])
}

export function updateActiveOutputTarget(kind: OutputTargetKind): Promise<void> {
  requireElectron()
  return apiCall<void>('config', 'setActiveOutputTarget', [kind])
}

/** The Local Target's Output Device; `null` is "System default". The label is kept so an absent device can still be named. */
export interface LocalOutputDevice {
  deviceId: string
  label: string
}

export function fetchLocalOutputDevice(): Promise<LocalOutputDevice | null> {
  requireElectron()
  return apiCall<LocalOutputDevice | null>('config', 'getLocalOutputDevice', [])
}

export function updateLocalOutputDevice(device: LocalOutputDevice | null): Promise<void> {
  requireElectron()
  return apiCall<void>('config', 'setLocalOutputDevice', [device])
}

/** Master volume is stored per Output Target: pass `LOCAL_TARGET_ID` for the Local Target, a guild id (or empty) for the Discord Target. */
export function fetchMasterVolume(targetId: string): Promise<number> {
  requireElectron()
  return apiCall<number>('config', 'getMasterVolume', [targetId])
}

export function updateMasterVolume(targetId: string, volume: number): Promise<void> {
  requireElectron()
  return apiCall<void>('config', 'setMasterVolume', [targetId, volume])
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
