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
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return response.json()
}

export function fetchPlayerState(signal?: AbortSignal): Promise<PlayerStateItem[]> {
  return request('/api/player/state', { signal })
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

export function playTrack(payload: { guildId: string; trackId: string; channelId?: string }) {
  return request('/api/player/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function triggerEffect(payload: { guildId: string; effectId: string; channelId?: string }) {
  return request('/api/player/effect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
