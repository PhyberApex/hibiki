import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayerStore } from './player'

vi.mock('@/api/player', () => ({
  fetchPlayerState: vi.fn().mockResolvedValue([]),
  fetchBotStatus: vi.fn().mockResolvedValue({ ready: false }),
  fetchGuildDirectory: vi.fn().mockResolvedValue([]),
  joinChannel: vi.fn().mockResolvedValue(undefined),
  leaveGuild: vi.fn().mockResolvedValue(undefined),
  reconnectBot: vi.fn().mockResolvedValue(undefined),
  onPlayerStateChanged: vi.fn().mockReturnValue(() => {}),
  stopEffect: vi.fn().mockResolvedValue(undefined),
}))

describe('player store', () => {
  let fetchPlayerState: ReturnType<typeof vi.fn>
  let fetchBotStatus: ReturnType<typeof vi.fn>
  let fetchGuildDirectory: ReturnType<typeof vi.fn>
  let joinChannel: ReturnType<typeof vi.fn>
  let leaveGuild: ReturnType<typeof vi.fn>
  let reconnectBot: ReturnType<typeof vi.fn>
  let onPlayerStateChanged: ReturnType<typeof vi.fn>
  let stopEffect: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    setActivePinia(createPinia())
    const api = await import('@/api/player')
    fetchPlayerState = vi.mocked(api.fetchPlayerState)
    fetchBotStatus = vi.mocked(api.fetchBotStatus)
    fetchGuildDirectory = vi.mocked(api.fetchGuildDirectory)
    joinChannel = vi.mocked(api.joinChannel)
    leaveGuild = vi.mocked(api.leaveGuild)
    reconnectBot = vi.mocked(api.reconnectBot)
    onPlayerStateChanged = vi.mocked(api.onPlayerStateChanged)
    stopEffect = vi.mocked(api.stopEffect)
    vi.clearAllMocks()
    onPlayerStateChanged.mockReturnValue(() => {})
    stopEffect.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('loadState', () => {
    it('fetches player state and bot status', async () => {
      const state = [{ guildId: 'g1', isIdle: true, track: null, source: 'live' as const }]
      fetchPlayerState.mockResolvedValue(state)
      fetchBotStatus.mockResolvedValue({ ready: true, userTag: 'Bot#0' })

      const store = usePlayerStore()
      await store.loadState()

      expect(store.playerState).toEqual(state)
      expect(store.botStatus).toEqual({ ready: true, userTag: 'Bot#0' })
    })

    it('handles fetchBotStatus failure gracefully', async () => {
      fetchPlayerState.mockResolvedValue([])
      fetchBotStatus.mockRejectedValue(new Error('fail'))

      const store = usePlayerStore()
      await store.loadState()

      expect(store.playerState).toEqual([])
      expect(store.botStatus).toEqual({ ready: false })
    })

    it('catches errors silently when outside Electron', async () => {
      fetchPlayerState.mockRejectedValue(new Error('no electron'))

      const store = usePlayerStore()
      await store.loadState()

      expect(store.playerState).toEqual([])
    })
  })

  describe('loadDirectory', () => {
    it('sets directory on success', async () => {
      const dir = [{ guildId: 'g1', guildName: 'Guild', iconUrl: null, channels: [{ id: 'ch1', name: 'General' }] }]
      fetchGuildDirectory.mockResolvedValue(dir)

      const store = usePlayerStore()
      await store.loadDirectory()

      expect(store.directory).toEqual(dir)
      expect(store.directoryError).toBeNull()
    })

    it('sets directoryError on failure', async () => {
      fetchGuildDirectory.mockRejectedValue(new Error('Network error'))

      const store = usePlayerStore()
      await store.loadDirectory()

      expect(store.directoryError).toBe('Network error')
    })

    it('sets generic error message for non-Error throws', async () => {
      fetchGuildDirectory.mockRejectedValue('string error')

      const store = usePlayerStore()
      await store.loadDirectory()

      expect(store.directoryError).toBe('Failed to load guilds')
    })
  })

  describe('computed properties', () => {
    it('channels returns channels for selected guild', async () => {
      const dir = [
        { guildId: 'g1', guildName: 'Guild1', iconUrl: null, channels: [{ id: 'ch1', name: 'General' }] },
        { guildId: 'g2', guildName: 'Guild2', iconUrl: null, channels: [{ id: 'ch2', name: 'Music' }] },
      ]
      fetchGuildDirectory.mockResolvedValue(dir)

      const store = usePlayerStore()
      await store.loadDirectory()
      store.guildId = 'g1'

      expect(store.channels).toEqual([{ id: 'ch1', name: 'General' }])
    })

    it('channels returns empty array when no guild selected', () => {
      const store = usePlayerStore()
      expect(store.channels).toEqual([])
    })

    it('selectedGuildState returns matching state', async () => {
      const state = [{ guildId: 'g1', isIdle: true, track: null, source: 'live' as const }]
      fetchPlayerState.mockResolvedValue(state)
      fetchBotStatus.mockResolvedValue({ ready: true })

      const store = usePlayerStore()
      await store.loadState()
      store.guildId = 'g1'

      expect(store.selectedGuildState).toEqual(state[0])
    })

    it('isJoined returns true when connected', async () => {
      const state = [{ guildId: 'g1', connectedChannelId: 'ch1', isIdle: true, track: null, source: 'live' as const }]
      fetchPlayerState.mockResolvedValue(state)
      fetchBotStatus.mockResolvedValue({ ready: true })

      const store = usePlayerStore()
      await store.loadState()
      store.guildId = 'g1'

      expect(store.isJoined).toBe(true)
    })

    it('isJoined returns false when not connected', () => {
      const store = usePlayerStore()
      expect(store.isJoined).toBe(false)
    })

    it('connectedGuildId returns first connected guild', async () => {
      const state = [
        { guildId: 'g1', isIdle: true, track: null, source: 'live' as const },
        { guildId: 'g2', connectedChannelId: 'ch2', isIdle: false, track: null, source: 'live' as const },
      ]
      fetchPlayerState.mockResolvedValue(state)
      fetchBotStatus.mockResolvedValue({ ready: true })

      const store = usePlayerStore()
      await store.loadState()

      expect(store.connectedGuildId).toBe('g2')
    })

    it('scenePlaying is false when no Scene is playing', () => {
      const store = usePlayerStore()
      expect(store.playingSceneId).toBeNull()
      expect(store.playingSceneMode).toBeNull()
      expect(store.scenePlaying).toBe(false)
    })

    it('setPlayingScene sets both fields and scenePlaying becomes true', () => {
      const store = usePlayerStore()

      store.setPlayingScene('s1', 'g1')
      expect(store.playingSceneId).toBe('s1')
      expect(store.playingSceneMode).toBe('g1')
      expect(store.scenePlaying).toBe(true)
    })

    it('clearPlayingScene only clears when the Target id matches', () => {
      const store = usePlayerStore()
      store.setPlayingScene('s1', 'local')

      store.clearPlayingScene('g1')
      expect(store.playingSceneId).toBe('s1')
      expect(store.playingSceneMode).toBe('local')

      store.clearPlayingScene('local')
      expect(store.playingSceneId).toBeNull()
      expect(store.playingSceneMode).toBeNull()
      expect(store.scenePlaying).toBe(false)
    })
  })

  describe('active Output Target', () => {
    it('addresses playback to the Local Target id while Local is active, else the selected guild', () => {
      const store = usePlayerStore()
      store.guildId = 'g1'
      expect(store.targetId).toBe('g1')
      store.activeTarget = 'local'
      expect(store.targetId).toBe('local')
    })

    it('canPlay is true for Local without a voice connection, and for Discord only when joined', () => {
      const store = usePlayerStore()
      store.guildId = 'g1'
      expect(store.canPlay).toBe(false)
      store.activeTarget = 'local'
      expect(store.canPlay).toBe(true)
    })

    it('clearPlayingScene without a Target id clears whatever is playing', () => {
      const store = usePlayerStore()
      store.setPlayingScene('s1', 'local')
      store.clearPlayingScene()
      expect(store.playingSceneId).toBeNull()
    })
  })

  describe('selectChannel', () => {
    it('joins channel and loads state', async () => {
      const dir = [{ guildId: 'g1', guildName: 'Guild', iconUrl: null, channels: [{ id: 'ch1', name: 'General' }] }]
      fetchGuildDirectory.mockResolvedValue(dir)
      fetchPlayerState.mockResolvedValue([{ guildId: 'g1', connectedChannelId: 'ch1', isIdle: true, track: null, source: 'live' as const }])
      fetchBotStatus.mockResolvedValue({ ready: true })

      const store = usePlayerStore()
      await store.loadDirectory()
      await store.selectChannel('g1', 'ch1')

      expect(store.guildId).toBe('g1')
      expect(store.channelId).toBe('ch1')
      expect(joinChannel).toHaveBeenCalledWith('g1', 'ch1')
    })

    it('skips join when already connected to same channel', async () => {
      const state = [{ guildId: 'g1', connectedChannelId: 'ch1', isIdle: true, track: null, source: 'live' as const }]
      fetchPlayerState.mockResolvedValue(state)
      fetchBotStatus.mockResolvedValue({ ready: true })

      const store = usePlayerStore()
      await store.loadState()
      await store.selectChannel('g1', 'ch1')

      expect(joinChannel).not.toHaveBeenCalled()
    })

    it('does nothing with empty guildId or channelId', async () => {
      const store = usePlayerStore()
      await store.selectChannel('', 'ch1')
      await store.selectChannel('g1', '')
      expect(joinChannel).not.toHaveBeenCalled()
    })

    it('sets channelJoinBusy during join', async () => {
      let resolveFn: () => void
      joinChannel.mockImplementation(() => new Promise<void>((r) => {
        resolveFn = r
      }))
      fetchPlayerState.mockResolvedValue([])
      fetchBotStatus.mockResolvedValue({ ready: true })

      const store = usePlayerStore()
      const promise = store.selectChannel('g1', 'ch1')

      expect(store.channelJoinBusy).toBe(true)
      resolveFn!()
      await promise
      expect(store.channelJoinBusy).toBe(false)
    })
  })

  describe('doLeave', () => {
    it('calls leaveGuild and filters playerState', async () => {
      const state = [
        { guildId: 'g1', connectedChannelId: 'ch1', isIdle: true, track: null, source: 'live' as const },
        { guildId: 'g2', isIdle: true, track: null, source: 'live' as const },
      ]
      fetchPlayerState.mockResolvedValue(state)
      fetchBotStatus.mockResolvedValue({ ready: true })

      const store = usePlayerStore()
      await store.loadState()
      store.guildId = 'g1'
      store.channelId = 'ch1'

      await store.doLeave('g1')

      expect(leaveGuild).toHaveBeenCalledWith('g1')
      expect(store.playerState).toEqual([state[1]])
      expect(store.channelId).toBe('')
    })

    it('uses guildId when no argument provided', async () => {
      const store = usePlayerStore()
      store.guildId = 'g1'
      await store.doLeave()

      expect(leaveGuild).toHaveBeenCalledWith('g1')
    })

    it('does nothing when no targetGuildId', async () => {
      const store = usePlayerStore()
      await store.doLeave()
      expect(leaveGuild).not.toHaveBeenCalled()
    })
  })

  describe('doReconnect', () => {
    it('calls reconnectBot and resets state', async () => {
      vi.useFakeTimers()
      fetchPlayerState.mockResolvedValue([])
      fetchBotStatus.mockResolvedValue({ ready: true, userTag: 'Bot#0' })
      fetchGuildDirectory.mockResolvedValue([])

      const store = usePlayerStore()
      store.guildId = 'g1'
      store.channelId = 'ch1'

      const promise = store.doReconnect()

      expect(store.reconnecting).toBe(true)
      await promise

      expect(reconnectBot).toHaveBeenCalled()
      expect(store.reconnecting).toBe(false)
      vi.useRealTimers()
    })

    it('polls until bot is ready', async () => {
      vi.useFakeTimers()
      let callCount = 0
      fetchBotStatus.mockImplementation(() => {
        callCount++
        return Promise.resolve(callCount >= 2 ? { ready: true } : { ready: false })
      })
      fetchPlayerState.mockResolvedValue([])
      fetchGuildDirectory.mockResolvedValue([])

      const store = usePlayerStore()
      const promise = store.doReconnect()

      // First poll: not ready
      await vi.advanceTimersByTimeAsync(1000)
      // Second poll: ready
      await vi.advanceTimersByTimeAsync(1000)
      await promise

      expect(fetchGuildDirectory).toHaveBeenCalled()
      expect(store.reconnecting).toBe(false)
      vi.useRealTimers()
    })
  })

  describe('onPlayerStateChanged reaction', () => {
    it('reloads state when the backend pushes a state-changed notification', async () => {
      fetchPlayerState.mockResolvedValue([])
      fetchBotStatus.mockResolvedValue({ ready: true })

      usePlayerStore()
      expect(onPlayerStateChanged).toHaveBeenCalledTimes(1)
      const pushListener = onPlayerStateChanged.mock.calls[0][0] as () => void

      fetchPlayerState.mockClear()
      const newState = [{ guildId: 'g1', isIdle: true, track: null, source: 'live' as const }]
      fetchPlayerState.mockResolvedValue(newState)

      pushListener()
      await vi.waitFor(() => expect(fetchPlayerState).toHaveBeenCalled())
    })
  })

  describe('syncSelectionFromConnectedState', () => {
    it('syncs guild and channel from connected state', async () => {
      const state = [{ guildId: 'g1', connectedChannelId: 'ch1', isIdle: false, track: null, source: 'live' as const }]
      const dir = [{ guildId: 'g1', guildName: 'Guild1', iconUrl: null, channels: [{ id: 'ch1', name: 'General' }] }]
      fetchPlayerState.mockResolvedValue(state)
      fetchBotStatus.mockResolvedValue({ ready: true })
      fetchGuildDirectory.mockResolvedValue(dir)

      const store = usePlayerStore()
      await store.loadState()
      await store.loadDirectory()

      // The watch should have triggered syncSelectionFromConnectedState
      expect(store.guildId).toBe('g1')
      expect(store.channelId).toBe('ch1')
    })
  })

  describe('ensureChannelSelection', () => {
    it('clears channelId when no channels available', async () => {
      fetchGuildDirectory.mockResolvedValue([{ guildId: 'g1', guildName: 'Guild1', iconUrl: null, channels: [] }])

      const store = usePlayerStore()
      store.guildId = 'g1'
      store.channelId = 'ch1'
      await store.loadDirectory()

      expect(store.channelId).toBe('')
    })

    it('prefers connected channel id', async () => {
      const state = [{ guildId: 'g1', connectedChannelId: 'ch2', isIdle: true, track: null, source: 'live' as const }]
      const dir = [{ guildId: 'g1', guildName: 'Guild1', iconUrl: null, channels: [{ id: 'ch1', name: 'A' }, { id: 'ch2', name: 'B' }] }]
      fetchPlayerState.mockResolvedValue(state)
      fetchBotStatus.mockResolvedValue({ ready: true })
      fetchGuildDirectory.mockResolvedValue(dir)

      const store = usePlayerStore()
      store.guildId = 'g1'
      await store.loadState()
      await store.loadDirectory()

      expect(store.channelId).toBe('ch2')
    })

    it('clears channelId when selected channel not in list', async () => {
      const dir = [{ guildId: 'g1', guildName: 'Guild1', iconUrl: null, channels: [{ id: 'ch1', name: 'General' }] }]
      fetchGuildDirectory.mockResolvedValue(dir)

      const store = usePlayerStore()
      store.guildId = 'g1'
      store.channelId = 'nonexistent'
      await store.loadDirectory()

      expect(store.channelId).toBe('')
    })
  })

  describe('effect instances (#509)', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('registers a renderer-tracked instance and reports it via effectStatus', () => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      const store = usePlayerStore()

      const id = store.registerRendererEffectInstance('fx1', vi.fn())

      expect(store.effectStatus('fx1')).toEqual({ count: 1, elapsedMs: 0, totalMs: 0 })
      expect(store.effectStatus('fx2')).toBeNull()
      expect(id).toMatch(/^effect-/)
    })

    it('tracks elapsed time against a renderer instance\'s duration once set', () => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      const store = usePlayerStore()
      const id = store.registerRendererEffectInstance('fx1', vi.fn())
      store.setEffectInstanceDuration(id, 2000)

      // The ticking interval runs every 200 ms, so advancing by a multiple
      // of it lands effectTick exactly on a tick boundary.
      vi.advanceTimersByTime(600)

      expect(store.effectStatus('fx1')).toEqual({ count: 1, elapsedMs: 600, totalMs: 2000 })
    })

    it('tracks the longest-remaining of several instances of the same sound, and counts them', () => {
      vi.useFakeTimers()
      vi.setSystemTime(0)
      const store = usePlayerStore()
      const first = store.registerRendererEffectInstance('fx1', vi.fn())
      store.setEffectInstanceDuration(first, 1000) // finishes at t=1000

      vi.advanceTimersByTime(100)
      const second = store.registerRendererEffectInstance('fx1', vi.fn())
      store.setEffectInstanceDuration(second, 3000) // finishes at t=3100, later than first

      vi.advanceTimersByTime(500) // now t=600: first remaining 400, second remaining 2500

      const status = store.effectStatus('fx1')!
      expect(status.count).toBe(2)
      // The second instance (finishing later) drives the fill/timer.
      expect(status.totalMs).toBe(3000)
      expect(status.elapsedMs).toBe(500) // 600 - 100
    })

    it('removeRendererEffectInstance tears the instance down via its stop callback and clears it', () => {
      const store = usePlayerStore()
      const stop = vi.fn()
      const id = store.registerRendererEffectInstance('fx1', stop)

      store.removeRendererEffectInstance(id)

      expect(stop).toHaveBeenCalledTimes(1)
      expect(store.effectStatus('fx1')).toBeNull()
    })

    it('removeRendererEffectInstance is a no-op for an unknown id', () => {
      const store = usePlayerStore()
      expect(() => store.removeRendererEffectInstance('nope')).not.toThrow()
    })

    it('evicts the oldest renderer-tracked instance once the renderer-side cap of 8 is reached', () => {
      const store = usePlayerStore()
      const stops = Array.from({ length: 9 }, () => vi.fn())
      const ids = stops.map(stop => store.registerRendererEffectInstance('fx1', stop))

      expect(stops[0]).toHaveBeenCalledTimes(1)
      for (let i = 1; i < 9; i++)
        expect(stops[i]).not.toHaveBeenCalled()
      expect(store.effectStatus('fx1')!.count).toBe(8)
      expect(ids).toHaveLength(9)
    })

    it('removeAllRendererEffectInstances clears every renderer-tracked instance regardless of sound', () => {
      const store = usePlayerStore()
      const stopA = vi.fn()
      const stopB = vi.fn()
      store.registerRendererEffectInstance('fx1', stopA)
      store.registerRendererEffectInstance('fx2', stopB)

      store.removeAllRendererEffectInstances()

      expect(stopA).toHaveBeenCalledTimes(1)
      expect(stopB).toHaveBeenCalledTimes(1)
      expect(store.effectStatus('fx1')).toBeNull()
      expect(store.effectStatus('fx2')).toBeNull()
    })

    it('syncs backend-reported Effect Instances from playerState for the selected guild', async () => {
      const state = [{
        guildId: 'g1',
        isIdle: false,
        track: null,
        source: 'live' as const,
        effects: [{ instanceId: 'backend-effect:1', soundId: 'fx1', startedAt: new Date(1000).toISOString(), durationMs: 2000 }],
      }]
      fetchPlayerState.mockResolvedValue(state)
      fetchBotStatus.mockResolvedValue({ ready: true })
      const store = usePlayerStore()
      store.guildId = 'g1'

      await store.loadState()

      expect(store.effectStatus('fx1')).toEqual({ count: 1, elapsedMs: expect.any(Number), totalMs: 2000 })
    })

    it('drops a backend-reported instance once it no longer appears in playerState (played out, evicted, or stopped)', async () => {
      const withEffect = [{
        guildId: 'g1',
        isIdle: false,
        track: null,
        source: 'live' as const,
        effects: [{ instanceId: 'backend-effect:1', soundId: 'fx1', startedAt: new Date().toISOString(), durationMs: 2000 }],
      }]
      fetchPlayerState.mockResolvedValue(withEffect)
      fetchBotStatus.mockResolvedValue({ ready: true })
      const store = usePlayerStore()
      store.guildId = 'g1'
      await store.loadState()
      expect(store.effectStatus('fx1')).not.toBeNull()

      fetchPlayerState.mockResolvedValue([{ guildId: 'g1', isIdle: true, track: null, source: 'live' as const, effects: [] }])
      await store.loadState()

      expect(store.effectStatus('fx1')).toBeNull()
    })

    it('never syncs backend instances from a guild other than the selected one', async () => {
      const state = [{
        guildId: 'g2',
        isIdle: false,
        track: null,
        source: 'live' as const,
        effects: [{ instanceId: 'backend-effect:1', soundId: 'fx1', startedAt: new Date().toISOString(), durationMs: 2000 }],
      }]
      fetchPlayerState.mockResolvedValue(state)
      fetchBotStatus.mockResolvedValue({ ready: true })
      const store = usePlayerStore()
      store.guildId = 'g1'

      await store.loadState()

      expect(store.effectStatus('fx1')).toBeNull()
    })

    it('stopEffectSound stops every instance of a sound across both origins, leaving other sounds untouched', async () => {
      const state = [{
        guildId: 'g1',
        isIdle: false,
        track: null,
        source: 'live' as const,
        effects: [{ instanceId: 'backend-effect:1', soundId: 'fx1', startedAt: new Date().toISOString(), durationMs: 2000 }],
      }]
      fetchPlayerState.mockResolvedValue(state)
      fetchBotStatus.mockResolvedValue({ ready: true })
      const store = usePlayerStore()
      store.guildId = 'g1'
      await store.loadState()
      const rendererStop = vi.fn()
      store.registerRendererEffectInstance('fx1', rendererStop)
      const otherStop = vi.fn()
      store.registerRendererEffectInstance('fx2', otherStop)

      await store.stopEffectSound('fx1')

      expect(rendererStop).toHaveBeenCalledTimes(1)
      expect(otherStop).not.toHaveBeenCalled()
      expect(stopEffect).toHaveBeenCalledWith('g1', 'backend-effect:1')
      expect(store.effectStatus('fx1')).toBeNull()
      expect(store.effectStatus('fx2')).not.toBeNull()
    })

    it('a stale snapshot arriving while a stop is in flight does not resurrect the stopped instance', async () => {
      let resolveStop!: () => void
      stopEffect.mockImplementation(() => new Promise<void>((resolve) => {
        resolveStop = resolve
      }))
      const state = [{
        guildId: 'g1',
        isIdle: false,
        track: null,
        source: 'live' as const,
        effects: [{ instanceId: 'backend-effect:1', soundId: 'fx1', startedAt: new Date().toISOString(), durationMs: 2000 }],
      }]
      fetchPlayerState.mockResolvedValue(state)
      fetchBotStatus.mockResolvedValue({ ready: true })
      const store = usePlayerStore()
      store.guildId = 'g1'
      await store.loadState()

      const stopPromise = store.stopEffectSound('fx1')
      await store.loadState() // stale snapshot still lists the instance

      expect(store.effectStatus('fx1')).toBeNull()
      resolveStop()
      await stopPromise
    })

    it('stopEffectSound drops the backend-origin entry immediately, without waiting for the IPC call to resolve', async () => {
      let resolveStop!: () => void
      stopEffect.mockImplementation(() => new Promise<void>((resolve) => {
        resolveStop = resolve
      }))
      const state = [{
        guildId: 'g1',
        isIdle: false,
        track: null,
        source: 'live' as const,
        effects: [{ instanceId: 'backend-effect:1', soundId: 'fx1', startedAt: new Date().toISOString(), durationMs: 2000 }],
      }]
      fetchPlayerState.mockResolvedValue(state)
      fetchBotStatus.mockResolvedValue({ ready: true })
      const store = usePlayerStore()
      store.guildId = 'g1'
      await store.loadState()

      const stopPromise = store.stopEffectSound('fx1')

      expect(store.effectStatus('fx1')).toBeNull()
      resolveStop()
      await stopPromise
    })
  })
})
