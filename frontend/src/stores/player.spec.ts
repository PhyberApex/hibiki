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
}))

describe('player store', () => {
  let fetchPlayerState: ReturnType<typeof vi.fn>
  let fetchBotStatus: ReturnType<typeof vi.fn>
  let fetchGuildDirectory: ReturnType<typeof vi.fn>
  let joinChannel: ReturnType<typeof vi.fn>
  let leaveGuild: ReturnType<typeof vi.fn>
  let reconnectBot: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    setActivePinia(createPinia())
    const api = await import('@/api/player')
    fetchPlayerState = vi.mocked(api.fetchPlayerState)
    fetchBotStatus = vi.mocked(api.fetchBotStatus)
    fetchGuildDirectory = vi.mocked(api.fetchGuildDirectory)
    joinChannel = vi.mocked(api.joinChannel)
    leaveGuild = vi.mocked(api.leaveGuild)
    reconnectBot = vi.mocked(api.reconnectBot)
    vi.clearAllMocks()
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
})
