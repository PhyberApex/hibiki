import { describe, expect, it } from 'vitest'
import { selectBackendPlaybackPath } from './backend-playback-path'

describe('selectBackendPlaybackPath', () => {
  it('uses the backend-decoded path when the file can decode', () => {
    expect(selectBackendPlaybackPath(true)).toBe('backend')
  })

  it('falls back to the renderer path when the file has no backend decoder (e.g. m4a)', () => {
    expect(selectBackendPlaybackPath(false)).toBe('renderer')
  })
})
