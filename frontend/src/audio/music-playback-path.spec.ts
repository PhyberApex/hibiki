import { describe, expect, it } from 'vitest'
import { selectMusicPlaybackPath } from './music-playback-path'

describe('selectMusicPlaybackPath', () => {
  it('stays in the renderer for local preview, regardless of backend decodability', () => {
    expect(selectMusicPlaybackPath({ joined: false, canDecodeBackend: true })).toBe('local')
    expect(selectMusicPlaybackPath({ joined: false, canDecodeBackend: false })).toBe('local')
  })

  it('uses the backend-decoded path when connected and the file can decode', () => {
    expect(selectMusicPlaybackPath({ joined: true, canDecodeBackend: true })).toBe('backend')
  })

  it('falls back to the renderer path when connected but the file has no backend decoder (e.g. m4a)', () => {
    expect(selectMusicPlaybackPath({ joined: true, canDecodeBackend: false })).toBe('renderer')
  })
})
