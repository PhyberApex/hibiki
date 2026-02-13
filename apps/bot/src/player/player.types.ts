import { SoundCategory } from '../sound/sound.types';

export interface TrackSummary {
  id: string;
  name: string;
  filename: string;
  category: SoundCategory;
}

export interface GuildPlaybackState {
  guildId: string;
  connectedChannelId?: string;
  connectedChannelName?: string;
  isIdle: boolean;
  track?: TrackSummary | null;
  source: 'live' | 'snapshot';
  lastUpdated?: string;
}
