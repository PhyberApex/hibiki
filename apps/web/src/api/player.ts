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
  source: 'live' | 'snapshot'
  lastUpdated?: string
}

export interface GuildDirectoryEntry {
  guildId: string
  guildName: string
  channels: { id: string, name: string }[]
}

/** Extract a user-facing message from a Nest error response body. */
async function getErrorMessage(response: Response): Promise<string> {
  const text = await response.text()
  if (!text)
    return `Request failed (${response.status})`
  try {
    const body = JSON.parse(text) as { message?: string | string[], error?: string }
    const msg = body.message
    if (typeof msg === 'string')
      return msg
    if (Array.isArray(msg) && msg.length)
      return String(msg[0] ?? `Request failed (${response.status})`)
    if (body.error)
      return `${body.error}: ${response.status}`
  }
  catch {
    // non-JSON or no message field
  }
  return `Request failed (${response.status})`
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const message = await getErrorMessage(response)
    throw new Error(message)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return response.json()
}

export interface BotStatus {
  ready: boolean
  userTag?: string
}

export function fetchPlayerState(signal?: AbortSignal): Promise<PlayerStateItem[]> {
  return request('/api/player/state', { signal })
}

export function fetchBotStatus(signal?: AbortSignal): Promise<BotStatus> {
  return request('/api/player/bot-status', { signal })
}

export function joinChannel(guildId: string, channelId: string) {
  return request('/api/player/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guildId, channelId }),
  })
}

export function leaveGuild(guildId: string) {
  return request('/api/player/leave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guildId }),
  })
}

export function stopPlayback(guildId: string) {
  return request('/api/player/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guildId }),
  })
}

export function playTrack(payload: { guildId: string, trackId: string, channelId?: string }) {
  return request('/api/player/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function triggerEffect(payload: { guildId: string, effectId: string, channelId?: string }) {
  return request('/api/player/effect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function fetchGuildDirectory(signal?: AbortSignal): Promise<GuildDirectoryEntry[]> {
  return request('/api/player/guilds', { signal })
}
