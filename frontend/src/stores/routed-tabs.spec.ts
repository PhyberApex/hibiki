import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { sendEffectChunk, setEffectStreamVolume, startEffectStream, stopEffectStream } from '@/api/audio-stream'
import { getBrowserViewMediaSourceId, setBrowserViewAudioMuted } from '@/api/browser-view'
import { captureFromMediaStream, captureTabStream } from '@/audio/browser-audio-capture'
import { createRoutedTabLocalPlayback } from '@/audio/routed-tab-local-playback'
import { usePlayerStore } from '@/stores/player'
import { useScenePlaybackStore } from '@/stores/scene-playback'
import { useRoutedTabsStore } from './routed-tabs'

vi.mock('@/api/scenes', () => ({ getScene: vi.fn() }))
vi.mock('@/api/sounds', () => ({ soundStreamUrl: vi.fn(), canDecode: vi.fn().mockResolvedValue(true) }))
vi.mock('@/api/player', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/player')>()
  return {
    ...actual,
    stopMusic: vi.fn().mockResolvedValue(undefined),
    stopAmbience: vi.fn().mockResolvedValue(undefined),
    stopEffects: vi.fn().mockResolvedValue(undefined),
  }
})
vi.mock('@/api/config', () => ({
  fetchSceneFadeLength: vi.fn().mockResolvedValue(0),
  fetchMasterVolume: vi.fn().mockResolvedValue(50),
  updateMasterVolume: vi.fn().mockResolvedValue(undefined),
  fetchActiveOutputTarget: vi.fn().mockResolvedValue('local'),
  updateActiveOutputTarget: vi.fn().mockResolvedValue(undefined),
  LOCAL_TARGET_ID: 'local',
}))
vi.mock('@/api/audio-stream', () => ({
  sendEffectChunk: vi.fn(),
  startEffectStream: vi.fn().mockResolvedValue('browser-1'),
  stopEffectStream: vi.fn().mockResolvedValue(undefined),
  setEffectStreamVolume: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/api/browser-view', () => ({
  getBrowserViewMediaSourceId: vi.fn().mockResolvedValue('source-1'),
  setBrowserViewAudioMuted: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/audio/browser-audio-capture', () => ({
  captureTabStream: vi.fn(),
  captureFromMediaStream: vi.fn(),
}))
vi.mock('@/audio/routed-tab-local-playback', () => ({
  createRoutedTabLocalPlayback: vi.fn(),
}))

const captureStop = vi.fn()
const localStop = vi.fn()
const localSetLevel = vi.fn()

function joinDiscord(guildId = 'g1') {
  const player = usePlayerStore()
  player.activeTarget = 'discord'
  player.guildId = guildId
  player.playerState = [{ guildId, connectedChannelId: 'c1' } as never]
}

function flush() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('routed tabs store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    const track = { stop: vi.fn() }
    vi.mocked(captureTabStream).mockResolvedValue({ getTracks: () => [track] } as unknown as MediaStream)
    vi.mocked(captureFromMediaStream).mockResolvedValue({ stop: captureStop })
    vi.mocked(createRoutedTabLocalPlayback).mockResolvedValue({ stop: localStop, setLevel: localSetLevel })
    useScenePlaybackStore().masterVolume = 50
  })

  it('starts a new tab at Tab Volume 100 and un-routed', () => {
    const store = useRoutedTabsStore()
    expect(store.tabVolume(7)).toBe(100)
    expect(store.isRouted(7)).toBe(false)
    expect(store.routedCount).toBe(0)
  })

  describe('under a Discord Target', () => {
    beforeEach(() => joinDiscord())

    it('routing starts a keyed effect stream at Tab Volume × master and pipes the tab capture into it', async () => {
      const store = useRoutedTabsStore()
      store.setTabVolume(7, 80)

      await store.setRouted(7, true)

      expect(getBrowserViewMediaSourceId).toHaveBeenCalledWith(7)
      expect(startEffectStream).toHaveBeenCalledWith('g1', 'browser-7', 40)
      expect(captureTabStream).toHaveBeenCalledWith('source-1')
      expect(captureFromMediaStream).toHaveBeenCalledTimes(1)
      const onChunk = vi.mocked(captureFromMediaStream).mock.calls[0][1]
      const pcm = new ArrayBuffer(4)
      onChunk(pcm)
      expect(sendEffectChunk).toHaveBeenCalledWith('g1', pcm, 'browser-7')
      expect(store.isRouted(7)).toBe(true)
      expect(store.routedCount).toBe(1)
      expect(setBrowserViewAudioMuted).not.toHaveBeenCalled()
    })

    it('a master volume change re-sends the level for every routed tab', async () => {
      const store = useRoutedTabsStore()
      await store.setRouted(1, true)
      store.setTabVolume(2, 50)
      await store.setRouted(2, true)
      vi.mocked(setEffectStreamVolume).mockClear()

      useScenePlaybackStore().masterVolume = 100
      await nextTick()

      expect(setEffectStreamVolume).toHaveBeenCalledWith('g1', 'browser-1', 100)
      expect(setEffectStreamVolume).toHaveBeenCalledWith('g1', 'browser-2', 50)
      expect(setEffectStreamVolume).toHaveBeenCalledTimes(2)
    })

    it('a Tab Volume change re-sends only that tab\'s level', async () => {
      const store = useRoutedTabsStore()
      await store.setRouted(1, true)
      await store.setRouted(2, true)

      store.setTabVolume(2, 20)

      expect(setEffectStreamVolume).toHaveBeenCalledTimes(1)
      expect(setEffectStreamVolume).toHaveBeenCalledWith('g1', 'browser-2', 10)
    })

    it('a Tab Volume change on a tab that is not routed is remembered but sends nothing', async () => {
      const store = useRoutedTabsStore()
      store.setTabVolume(3, 30)
      expect(store.tabVolume(3)).toBe(30)
      expect(setEffectStreamVolume).not.toHaveBeenCalled()

      await store.setRouted(3, true)
      expect(startEffectStream).toHaveBeenCalledWith('g1', 'browser-3', 15)
    })

    it('un-routing stops the capture and the stream', async () => {
      const store = useRoutedTabsStore()
      await store.setRouted(1, true)

      await store.setRouted(1, false)

      expect(captureStop).toHaveBeenCalledTimes(1)
      expect(stopEffectStream).toHaveBeenCalledWith('g1', 'browser-1')
      expect(store.isRouted(1)).toBe(false)
    })

    it('leaving the channel stops the stream but keeps the tab routed, and rejoining resumes it', async () => {
      const store = useRoutedTabsStore()
      await store.setRouted(1, true)
      vi.mocked(startEffectStream).mockClear()

      usePlayerStore().playerState = [{ guildId: 'g1', connectedChannelId: undefined } as never]
      await nextTick()
      await flush()

      expect(stopEffectStream).toHaveBeenCalledWith('g1', 'browser-1')
      expect(store.isRouted(1)).toBe(true)

      joinDiscord()
      await nextTick()
      await flush()

      expect(startEffectStream).toHaveBeenCalledWith('g1', 'browser-1', 50)
    })

    it('a failed capture leaves the tab un-routed and ends the stream it had opened', async () => {
      const store = useRoutedTabsStore()
      vi.mocked(captureTabStream).mockRejectedValueOnce(new Error('no tab'))
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      await store.setRouted(1, true)

      expect(stopEffectStream).toHaveBeenCalledWith('g1', 'browser-1')
      expect(store.isRouted(1)).toBe(false)
      expect(error).toHaveBeenCalled()
    })
  })

  describe('under the Local Target', () => {
    beforeEach(() => {
      usePlayerStore().activeTarget = 'local'
    })

    it('routing mutes the view and replays the capture through the gain path at Tab Volume × master', async () => {
      const store = useRoutedTabsStore()
      store.setTabVolume(4, 60)

      await store.setRouted(4, true)

      expect(captureTabStream).toHaveBeenCalledWith('source-1')
      expect(createRoutedTabLocalPlayback).toHaveBeenCalledWith(expect.anything(), 0.3)
      expect(setBrowserViewAudioMuted).toHaveBeenCalledWith(4, true)
      expect(startEffectStream).not.toHaveBeenCalled()
    })

    it('volume changes drive the gain, not the backend', async () => {
      const store = useRoutedTabsStore()
      await store.setRouted(4, true)

      store.setTabVolume(4, 50)
      expect(localSetLevel).toHaveBeenCalledWith(0.25)

      useScenePlaybackStore().masterVolume = 80
      await nextTick()
      expect(localSetLevel).toHaveBeenCalledWith(0.4)
      expect(setEffectStreamVolume).not.toHaveBeenCalled()
    })

    it('un-routing releases the gain path and unmutes the view', async () => {
      const store = useRoutedTabsStore()
      await store.setRouted(4, true)

      await store.setRouted(4, false)

      expect(localStop).toHaveBeenCalledTimes(1)
      expect(setBrowserViewAudioMuted).toHaveBeenLastCalledWith(4, false)
    })

    it('a mute that fails tears the gain path down and leaves the tab un-routed', async () => {
      const store = useRoutedTabsStore()
      vi.mocked(setBrowserViewAudioMuted).mockRejectedValueOnce(new Error('gone'))
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await store.setRouted(4, true)

      expect(localStop).toHaveBeenCalledTimes(1)
      expect(store.isRouted(4)).toBe(false)
    })
  })

  describe('target handover', () => {
    it('switching Local -> Discord stops locally, waits for a join, then streams', async () => {
      usePlayerStore().activeTarget = 'local'
      const store = useRoutedTabsStore()
      await store.setRouted(4, true)

      const player = usePlayerStore()
      player.activeTarget = 'discord'
      player.guildId = 'g1'
      await nextTick()
      await flush()

      expect(localStop).toHaveBeenCalledTimes(1)
      expect(setBrowserViewAudioMuted).toHaveBeenLastCalledWith(4, false)
      expect(startEffectStream).not.toHaveBeenCalled()
      expect(store.isRouted(4)).toBe(true)

      joinDiscord()
      await nextTick()
      await flush()

      expect(startEffectStream).toHaveBeenCalledWith('g1', 'browser-4', 50)
    })

    it('switching Discord -> Local ends the stream and starts the local replay immediately', async () => {
      joinDiscord()
      const store = useRoutedTabsStore()
      await store.setRouted(4, true)

      usePlayerStore().activeTarget = 'local'
      await nextTick()
      await flush()

      expect(stopEffectStream).toHaveBeenCalledWith('g1', 'browser-4')
      expect(createRoutedTabLocalPlayback).toHaveBeenCalledTimes(1)
      expect(setBrowserViewAudioMuted).toHaveBeenCalledWith(4, true)
    })
  })

  it('closing a tab ends its routing and drops its Tab Volume', async () => {
    joinDiscord()
    const store = useRoutedTabsStore()
    store.setTabVolume(9, 10)
    await store.setRouted(9, true)

    await store.forgetTab(9)

    expect(stopEffectStream).toHaveBeenCalledWith('g1', 'browser-9')
    expect(store.isRouted(9)).toBe(false)
    expect(store.routedCount).toBe(0)
    expect(store.tabVolume(9)).toBe(100)
  })

  it('un-routing while the route is still starting waits for it and then stops it', async () => {
    joinDiscord()
    const store = useRoutedTabsStore()

    let startResolve: (id: string) => void = () => {}
    vi.mocked(startEffectStream).mockImplementationOnce(() => new Promise(resolve => (startResolve = resolve)))

    const routing = store.setRouted(5, true)
    await flush()
    expect(startEffectStream).toHaveBeenCalledTimes(1)
    const unrouting = store.setRouted(5, false)
    startResolve('browser-5')
    await Promise.all([routing, unrouting])

    expect(startEffectStream).toHaveBeenCalledTimes(1)
    expect(captureStop).toHaveBeenCalledTimes(1)
    expect(stopEffectStream).toHaveBeenCalledWith('g1', 'browser-5')
    expect(store.isRouted(5)).toBe(false)
  })

  it('toggling twice before anything started leaves nothing running', async () => {
    joinDiscord()
    const store = useRoutedTabsStore()

    await Promise.all([store.toggleRouting(5), store.toggleRouting(5)])

    expect(startEffectStream).not.toHaveBeenCalled()
    expect(store.isRouted(5)).toBe(false)
  })
})
