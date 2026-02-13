export interface PlayerTrackInfo {
  id: string;
  name: string;
  filename: string;
  category: string;
}

export interface PlayerStateItem {
  guildId: string;
  connectedChannelId?: string;
  connectedChannelName?: string;
  isIdle: boolean;
  track: PlayerTrackInfo | null;
}

export async function fetchPlayerState(signal?: AbortSignal): Promise<PlayerStateItem[]> {
  const response = await fetch('/api/player/state', { signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch player state (${response.status})`);
  }
  return response.json();
}
