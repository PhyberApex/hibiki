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
  /** Present when live; music and effects volume 0–100. */
  volume?: { music: number, effects: number }
}
