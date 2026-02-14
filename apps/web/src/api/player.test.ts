import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBotStatus,
  fetchGuildDirectory,
  fetchPlayerState,
  joinChannel,
  leaveGuild,
  playTrack,
  stopPlayback,
  triggerEffect,
} from './player'

describe('player API', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetchPlayerState returns state array', async () => {
    const state = [{ guildId: 'g1', isIdle: true, track: null, source: 'live' as const }]
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(state),
    } as Response)
    const result = await fetchPlayerState()
    expect(result).toEqual(state)
    expect(fetch).toHaveBeenCalledWith('/api/player/state', { signal: undefined })
  })

  it('fetchBotStatus returns status', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ready: true, userTag: 'Bot#0' }),
    } as Response)
    const result = await fetchBotStatus()
    expect(result).toEqual({ ready: true, userTag: 'Bot#0' })
  })

  it('joinChannel sends POST with guildId and channelId', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response)
    await joinChannel('guild-1', 'ch-1')
    expect(fetch).toHaveBeenCalledWith('/api/player/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId: 'guild-1', channelId: 'ch-1' }),
    })
  })

  it('leaveGuild sends POST with guildId', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response)
    await leaveGuild('guild-1')
    expect(fetch).toHaveBeenCalledWith('/api/player/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId: 'guild-1' }),
    })
  })

  it('stopPlayback sends POST', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    } as Response)
    await stopPlayback('guild-1')
    expect(fetch).toHaveBeenCalledWith('/api/player/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId: 'guild-1' }),
    })
  })

  it('playTrack sends POST with payload', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'ok', track: { id: 't1', name: 'Track', filename: 't.mp3', category: 'music' } }),
    } as Response)
    await playTrack({ guildId: 'g1', trackId: 't1', channelId: 'ch1' })
    expect(fetch).toHaveBeenCalledWith('/api/player/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId: 'g1', trackId: 't1', channelId: 'ch1' }),
    })
  })

  it('triggerEffect sends POST with payload', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'ok', effect: {} }),
    } as Response)
    await triggerEffect({ guildId: 'g1', effectId: 'e1' })
    expect(fetch).toHaveBeenCalledWith('/api/player/effect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId: 'g1', effectId: 'e1' }),
    })
  })

  it('fetchGuildDirectory returns directory', async () => {
    const dir = [{ guildId: 'g1', guildName: 'Guild', channels: [{ id: 'ch1', name: 'General' }] }]
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(dir),
    } as Response)
    const result = await fetchGuildDirectory()
    expect(result).toEqual(dir)
  })

  it('throws with API message on error', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve(JSON.stringify({ message: 'Bad request' })),
    } as Response)
    await expect(fetchPlayerState()).rejects.toThrow('Bad request')
  })
})
