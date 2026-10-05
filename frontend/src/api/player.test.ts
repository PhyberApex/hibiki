import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchBotStatus,
  fetchGuildDirectory,
  fetchPlayerState,
  joinChannel,
  leaveGuild,
  playAmbience,
  playMusic,
  reconnectBot,
  setAmbienceVolume,
  setMusicVolume,
  setVolume,
  stopAmbience,
  stopMusic,
  stopPlayback,
} from './player'

describe('player API', () => {
  const mockInvoke = vi.fn()

  beforeEach(() => {
    (globalThis as any).window = globalThis
    ;(window as any).hibiki = { invoke: mockInvoke }
  })
  afterEach(() => {
    delete (window as any).hibiki
  })

  it('fetchPlayerState uses apiCall', async () => {
    const state = [{ guildId: 'g1', isIdle: true, track: null, source: 'live' as const }]
    mockInvoke.mockResolvedValue(state)
    const result = await fetchPlayerState()
    expect(result).toEqual(state)
    expect(mockInvoke).toHaveBeenCalledWith('api', { domain: 'player', method: 'getState', args: [] })
  })

  it('fetchBotStatus uses apiCall', async () => {
    mockInvoke.mockResolvedValue({ ready: true, userTag: 'Bot#0' })
    const result = await fetchBotStatus()
    expect(result).toEqual({ ready: true, userTag: 'Bot#0' })
  })

  it('joinChannel uses apiCall', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await joinChannel('guild-1', 'ch-1')
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'player',
      method: 'join',
      args: [{ guildId: 'guild-1', channelId: 'ch-1' }],
    })
  })

  it('leaveGuild uses apiCall', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await leaveGuild('guild-1')
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'player',
      method: 'leave',
      args: [{ guildId: 'guild-1' }],
    })
  })

  it('stopPlayback uses apiCall', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await stopPlayback('guild-1')
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'player',
      method: 'stop',
      args: ['guild-1'],
    })
  })

  it('fetchGuildDirectory uses apiCall', async () => {
    const dir = [{ guildId: 'g1', guildName: 'Guild', iconUrl: null, channels: [{ id: 'ch1', name: 'General' }] }]
    mockInvoke.mockResolvedValue(dir)
    const result = await fetchGuildDirectory()
    expect(result).toEqual(dir)
  })

  it('setVolume uses apiCall', async () => {
    mockInvoke.mockResolvedValue({ music: 80, effects: 90 })
    const result = await setVolume({ guildId: 'g1', music: 80, effects: 90 })
    expect(result).toEqual({ music: 80, effects: 90 })
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'player',
      method: 'setVolume',
      args: ['g1', { music: 80, effects: 90 }],
    })
  })

  it('playMusic uses apiCall', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await playMusic('g1', 'song-1', { volume: 80, loop: true, fadeInMs: 3000 })
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'player',
      method: 'playMusic',
      args: ['g1', 'song-1', { volume: 80, loop: true, fadeInMs: 3000 }],
    })
  })

  it('stopMusic uses apiCall, defaulting options to {}', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await stopMusic('g1')
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'player',
      method: 'stopMusic',
      args: ['g1', {}],
    })
  })

  it('setMusicVolume uses apiCall', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await setMusicVolume('g1', 40, { rampMs: 500 })
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'player',
      method: 'setMusicVolume',
      args: ['g1', 40, { rampMs: 500 }],
    })
  })

  it('playAmbience uses apiCall', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await playAmbience('g1', 'rain', { volume: 70, repeatMin: 5, repeatMax: 15, fadeInMs: 3000 })
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'player',
      method: 'playAmbience',
      args: ['g1', 'rain', { volume: 70, repeatMin: 5, repeatMax: 15, fadeInMs: 3000 }],
    })
  })

  it('stopAmbience uses apiCall, defaulting options to {}', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await stopAmbience('g1', 'rain')
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'player',
      method: 'stopAmbience',
      args: ['g1', 'rain', {}],
    })
  })

  it('setAmbienceVolume uses apiCall', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await setAmbienceVolume('g1', 'rain', 40, { rampMs: 500 })
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'player',
      method: 'setAmbienceVolume',
      args: ['g1', 'rain', 40, { rampMs: 500 }],
    })
  })

  it('reconnectBot uses apiCall', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await reconnectBot()
    expect(mockInvoke).toHaveBeenCalledWith('api', {
      domain: 'player',
      method: 'reconnect',
      args: [],
    })
  })

  it('throws when not in Electron', () => {
    delete (window as any).hibiki
    expect(() => fetchPlayerState()).toThrow('Electron app')
  })
})
