import type { LocalSinkHealth } from '../audio/local-sink'
import { apiCall, useElectronApi } from './electron'

export interface PlayerTrackInfo {
  id: string
  name: string
  filename: string
  category: string
}

/** One active backend-decoded Effect Instance (#509), as reported by `getState()`. */
export interface EffectInstanceInfo {
  instanceId: string
  soundId: string
  startedAt: string
  durationMs: number
}

export interface PlayerStateItem {
  guildId: string
  connectedChannelId?: string
  connectedChannelName?: string
  isIdle: boolean
  track: PlayerTrackInfo | null
  source: 'live' | 'discord'
  lastUpdated?: string
  /** soundIds of backend-decoded Ambience sounds currently active; only present when live. */
  ambience?: string[]
  /** Active backend-decoded Effect Instances; only present when live. */
  effects?: EffectInstanceInfo[]
}

export interface GuildDirectoryEntry {
  guildId: string
  guildName: string
  iconUrl: string | null
  channels: { id: string, name: string }[]
}

function requireElectron(): void {
  if (!useElectronApi())
    throw new Error('Hibiki runs as an Electron app. Open it via pnpm run electron.')
}

export interface BotStatus {
  ready: boolean
  userTag?: string
  /** Bot's Discord user id (for E2E / sidecar verification). */
  userId?: string
}

export function fetchPlayerState(): Promise<PlayerStateItem[]> {
  requireElectron()
  return apiCall('player', 'getState', [])
}

export function fetchBotStatus(): Promise<BotStatus> {
  requireElectron()
  return apiCall('player', 'getBotStatus', [])
}

export function joinChannel(guildId: string, channelId: string) {
  requireElectron()
  return apiCall('player', 'join', [
    { guildId, channelId },
  ])
}

export function leaveGuild(guildId: string) {
  requireElectron()
  return apiCall('player', 'leave', [
    { guildId },
  ])
}

export function stopPlayback(guildId: string) {
  requireElectron()
  return apiCall('player', 'stop', [guildId])
}

export function fetchGuildDirectory(): Promise<GuildDirectoryEntry[]> {
  requireElectron()
  return apiCall('player', 'getGuildDirectory', [])
}

export interface PlayMusicOptions {
  volume: number
  loop?: boolean
  fadeInMs?: number
}

/** Plays a Sound Library Music track decoded straight into the mixer (see ADR-0003). */
export function playMusic(guildId: string, soundId: string, options: PlayMusicOptions): Promise<void> {
  requireElectron()
  return apiCall<void>('player', 'playMusic', [guildId, soundId, options])
}

/** Stops the currently playing backend-decoded Music track, if any (distinct from the chunked-IPC `audio-stream` API's `stopAudioStream`). */
export function stopMusic(guildId: string, options: { fadeOutMs?: number } = {}): Promise<void> {
  requireElectron()
  return apiCall<void>('player', 'stopMusic', [guildId, options])
}

/** Changes the currently playing backend-decoded Music track's volume, if any. */
export function setMusicVolume(guildId: string, volume: number, options: { rampMs?: number } = {}): Promise<void> {
  requireElectron()
  return apiCall<void>('player', 'setMusicVolume', [guildId, volume, options])
}

export interface PlayAmbienceOptions {
  volume: number
  repeatMin: number
  repeatMax: number
  fadeInMs?: number
}

/** Plays a Sound Library Ambience sound decoded straight into the mixer (see ADR-0003). Several can be active at once per guild, keyed by soundId. */
export function playAmbience(guildId: string, soundId: string, options: PlayAmbienceOptions): Promise<void> {
  requireElectron()
  return apiCall<void>('player', 'playAmbience', [guildId, soundId, options])
}

/** Stops a backend-decoded Ambience sound, if playing (distinct from the chunked-IPC `audio-stream` API's `stopEffectStream`). */
export function stopAmbience(guildId: string, soundId: string, options: { fadeOutMs?: number } = {}): Promise<void> {
  requireElectron()
  return apiCall<void>('player', 'stopAmbience', [guildId, soundId, options])
}

/** Changes a backend-decoded Ambience sound's volume, if playing. */
export function setAmbienceVolume(guildId: string, soundId: string, volume: number, options: { rampMs?: number } = {}): Promise<void> {
  requireElectron()
  return apiCall<void>('player', 'setAmbienceVolume', [guildId, soundId, volume, options])
}

export interface PlayEffectOptions {
  volume: number
}

/** Plays a Sound Library Effect decoded straight into the mixer (see ADR-0003). Every trigger is its own instance; the same Effect can layer. Resolves with the new instance's id and duration (#509). */
export function playEffect(guildId: string, soundId: string, options: PlayEffectOptions): Promise<EffectInstanceInfo> {
  requireElectron()
  return apiCall<EffectInstanceInfo>('player', 'playEffect', [guildId, soundId, options])
}

export interface WarmEffectsResult {
  warmed: number
  skipped: number
  failed: number
}

/** Decodes a Scene's backend-decodable Effects into the backend's PCM cache ahead of their first trigger (#696); Target-independent. */
export function warmEffects(sceneId: string, soundIds: string[]): Promise<WarmEffectsResult> {
  requireElectron()
  return apiCall<WarmEffectsResult>('player', 'warmEffects', [sceneId, soundIds])
}

/** Ends every backend-decoded Effect instance for this guild (distinct from the chunked-IPC `audio-stream` API's `stopEffectStream`). */
export function stopEffects(guildId: string): Promise<void> {
  requireElectron()
  return apiCall<void>('player', 'stopEffects', [guildId])
}

/** Ends one backend-decoded Effect Instance by id, leaving every other instance untouched (#509) — a no-op if already ended. */
export function stopEffect(guildId: string, instanceId: string): Promise<void> {
  requireElectron()
  return apiCall<void>('player', 'stopEffect', [guildId, instanceId])
}

export function reconnectBot(): Promise<void> {
  requireElectron()
  return apiCall<void>('player', 'reconnect', [])
}

export function onPlayerStateChanged(callback: () => void): () => void {
  if (!window.hibiki?.on)
    return () => {}
  return window.hibiki.on('player:stateChanged', callback)
}

/** Reports the renderer's Local sink health to the backend (it lands in hibiki.log; a dead sink stops local playback). */
export function reportLocalSinkHealth(event: LocalSinkHealth): Promise<void> {
  return apiCall<void>('player', 'reportLocalSinkHealth', [event])
}
