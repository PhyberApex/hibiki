import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteSound,
  listEffects,
  listEffectsTags,
  listMusic,
  listMusicTags,
  setSoundTags,
  soundStreamUrl,
  uploadSound,
} from './sounds'

describe('sounds API', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('listMusic calls fetch without tag', async () => {
    const mockFetch = vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('[]'),
    } as Response)
    await listMusic()
    expect(mockFetch).toHaveBeenCalledWith('/api/sounds/music', { signal: undefined })
  })

  it('listMusic calls fetch with tag', async () => {
    const mockFetch = vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('[]'),
    } as Response)
    await listMusic('ambient')
    expect(mockFetch).toHaveBeenCalledWith('/api/sounds/music?tag=ambient', { signal: undefined })
  })

  it('listEffects calls fetch', async () => {
    const mockFetch = vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('[]'),
    } as Response)
    await listEffects()
    expect(mockFetch).toHaveBeenCalledWith('/api/sounds/effects', { signal: undefined })
  })

  it('listMusicTags returns parsed tags', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('["ambient","chill"]'),
    } as Response)
    const tags = await listMusicTags()
    expect(tags).toEqual(['ambient', 'chill'])
  })

  it('listEffectsTags returns parsed tags', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('["boom","click"]'),
    } as Response)
    const tags = await listEffectsTags()
    expect(tags).toEqual(['boom', 'click'])
  })

  it('setSoundTags sends PATCH with tags', async () => {
    const mockFetch = vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('{"tags":["a","b"]}'),
    } as Response)
    await setSoundTags('music', 'id1', ['a', 'b'])
    expect(mockFetch).toHaveBeenCalledWith('/api/sounds/music/id1/tags', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['a', 'b'] }),
      signal: undefined,
    })
  })

  it('uploadSound sends POST with FormData', async () => {
    const file = new File(['x'], 'test.mp3', { type: 'audio/mpeg' })
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve('{"id":"x","name":"test","filename":"test.mp3","category":"music"}'),
    } as Response)
    await uploadSound('music', file)
    expect(fetch).toHaveBeenCalledWith(
      '/api/sounds/music',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      }),
    )
  })

  it('deleteSound sends DELETE', async () => {
    const mockFetch = vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 204,
      text: () => Promise.resolve(''),
    } as Response)
    await deleteSound('effects', 'id1')
    expect(mockFetch).toHaveBeenCalledWith('/api/sounds/effects/id1', {
      method: 'DELETE',
      signal: undefined,
    })
  })

  it('soundStreamUrl returns URL', () => {
    expect(soundStreamUrl('music', 'id1')).toBe('/api/sounds/music/id1/file')
    expect(soundStreamUrl('effects', 'e1')).toBe('/api/sounds/effects/e1/file')
  })

  it('throws on non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve(''),
    } as Response)
    await expect(listMusic()).rejects.toThrow('Request failed (500)')
  })
})
