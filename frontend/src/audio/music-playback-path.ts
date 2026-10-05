export type MusicPlaybackPath = 'backend' | 'renderer' | 'local'

export interface MusicPlaybackPathInput {
  /** Whether the GM's app is connected to a Discord voice channel for this guild. */
  joined: boolean
  /** `sounds.canDecode('music', soundId)` — whether the backend can decode this file straight into the mixer. */
  canDecodeBackend: boolean
}

/**
 * Picks which playback mechanism Scene Music should use for a track, per
 * ADR-0003: local preview always stays in the renderer regardless of
 * decodability; a Discord-connected GM gets the backend-decoded path when
 * available, and the renderer fallback (audio element → chunked IPC)
 * otherwise (e.g. m4a/AAC, which has no backend decoder).
 */
export function selectMusicPlaybackPath({ joined, canDecodeBackend }: MusicPlaybackPathInput): MusicPlaybackPath {
  if (!joined)
    return 'local'
  return canDecodeBackend ? 'backend' : 'renderer'
}
