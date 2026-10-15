export type BackendPlaybackPath = 'backend' | 'renderer'

/**
 * Picks which playback mechanism a Scene Music or Ambience item should use,
 * per ADR-0003 and ADR-0004: any Output Target (Discord or Local) gets the
 * backend-decoded path when the file can decode, and the renderer fallback
 * otherwise (e.g. m4a/AAC, which has no backend decoder). Under the Local
 * Target the renderer fallback is the output itself and is not captured.
 */
export function selectBackendPlaybackPath(canDecodeBackend: boolean): BackendPlaybackPath {
  return canDecodeBackend ? 'backend' : 'renderer'
}
