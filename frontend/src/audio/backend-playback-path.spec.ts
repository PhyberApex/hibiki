import { describe, expect, it } from 'vitest'
import { selectBackendPlaybackPath } from './backend-playback-path'

describe('selectBackendPlaybackPath', () => {
  it('stays in the renderer for local preview, regardless of backend decodability', () => {
    expect(selectBackendPlaybackPath({ joined: false, canDecodeBackend: true })).toBe('local')
    expect(selectBackendPlaybackPath({ joined: false, canDecodeBackend: false })).toBe('local')
  })

  it('uses the backend-decoded path when connected and the file can decode', () => {
    expect(selectBackendPlaybackPath({ joined: true, canDecodeBackend: true })).toBe('backend')
  })

  it('falls back to the renderer path when connected but the file has no backend decoder (e.g. m4a)', () => {
    expect(selectBackendPlaybackPath({ joined: true, canDecodeBackend: false })).toBe('renderer')
  })
})
