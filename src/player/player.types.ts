import type { SoundCategory } from '../sound/sound.types'

export interface TrackSummary {
  id: string
  name: string
  filename: string
  category: SoundCategory
}

export interface GuildPlaybackState {
  guildId: string
  connectedChannelId?: string
  connectedChannelName?: string
  isIdle: boolean
  track?: TrackSummary | null
  source: 'live' | 'discord'
  lastUpdated?: string
  /** soundIds of backend-decoded Ambience sounds currently active; present when live. */
  ambience?: string[]
}
