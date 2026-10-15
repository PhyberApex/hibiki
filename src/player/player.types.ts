import type { EffectInstanceInfo } from '../audio/guild-audio.manager'
import type { SoundCategory } from '../sound/sound.types'
import type { OutputTargetKind } from './output-target'

export interface TrackSummary {
  id: string
  name: string
  filename: string
  category: SoundCategory
}

export interface GuildPlaybackState {
  /** The Output Target this entry describes: a Discord guild id, or `LOCAL_TARGET_ID`. */
  targetId: string
  kind: OutputTargetKind
  /** Same value as `targetId`; kept for existing consumers that look entries up by guild. */
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
  effects?: EffectInstanceInfo[]
}
