import { apiCall, useElectronApi } from './electron'

export interface PlayerTrackInfo {
  id: string
  name: string
  filename: string
  category: string
}

export interface PlayerStateItem {
  guildId: string
  connectedChannelId?: string
  connectedChannelName?: string
  isIdle: boolean
  track: PlayerTrackInfo | null
  source: 'live' | 'discord'
  lastUpdated?: string
  /** Music and effects volume 0–100; only present when live. */
  volume?: { music: number, effects: number }
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
  return apiCall('player', 'join', [{ guildId, channelId }])
}

export function leaveGuild(guildId: string) {
  requireElectron()
  return apiCall('player', 'leave', [{ guildId }])
}

export function stopPlayback(guildId: string) {
  requireElectron()
  return apiCall('player', 'stop', [guildId])
}

export function fetchGuildDirectory(): Promise<GuildDirectoryEntry[]> {
  requireElectron()
  return apiCall('player', 'getGuildDirectory', [])
}

export function setVolume(payload: {
  guildId: string
  music?: number
  effects?: number
}) {
  requireElectron()
  return apiCall<{ music: number, effects: number }>('player', 'setVolume', [payload.guildId, { music: payload.music, effects: payload.effects }])
}

export function reconnectBot(): Promise<void> {
  requireElectron()
  return apiCall<void>('player', 'reconnect', [])
}
