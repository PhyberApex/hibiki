import type { SoundCategory } from '../sound/sound.types'

export interface TrackSummary {
  id: string
  name: string
  filename: string
  category: SoundCategory
}

/** One active backend-decoded Effect Instance (#509) — see `GuildAudioManager.activeEffects`. */
export interface EffectInstanceSummary {
  instanceId: string
  soundId: string
  startedAt: string
  durationMs: number
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
  /** Active backend-decoded Effect Instances; present when live. */
  effects?: EffectInstanceSummary[]
}
