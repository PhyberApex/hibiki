import { defineStore } from 'pinia'
import { computed, reactive, watch } from 'vue'
import { sendEffectChunk, setEffectStreamVolume, startEffectStream, stopEffectStream } from '@/api/audio-stream'
import { getBrowserViewMediaSourceId, setBrowserViewAudioMuted } from '@/api/browser-view'
import { LOCAL_TARGET_ID } from '@/api/config'
import { trackUsage } from '@/api/usage-stats'
import { logDebug, logInfo } from '@/audio/audio-element-diagnostics'
import { captureFromMediaStream, captureTabStream } from '@/audio/browser-audio-capture'
import { createRoutedTabLocalPlayback } from '@/audio/routed-tab-local-playback'
import { usePlayerStore } from '@/stores/player'
import { useScenePlaybackStore } from '@/stores/scene-playback'

export const DEFAULT_TAB_VOLUME = 100

interface TabRouting {
  /** Tab Volume, 0–100 (CONTEXT.md). */
  volume: number
  routed: boolean
}

/** One live delivery of a Routed Tab to one Output Target. */
interface RoutingSession {
  targetId: string
  setLevel: (effective: number) => void
  stop: () => Promise<void>
}

/**
 * Routed Tabs and their Tab Volumes (CONTEXT.md, ADR-0007), owned here rather
 * than by the Browser view so the view can be kept alive or gone while a tab
 * keeps following the active Output Target, its master volume and the Target
 * handover. Per tab a routing session exists exactly while the tab is routed
 * and the active Target can play; everything else (handover, join/leave,
 * un-routing, closing) is a re-sync of that one invariant.
 */
export const useRoutedTabsStore = defineStore('routedTabs', () => {
  const player = usePlayerStore()
  const playback = useScenePlaybackStore()

  const tabs = reactive(new Map<number, TabRouting>())
  const sessions = new Map<number, RoutingSession>()
  const syncQueues = new Map<number, Promise<void>>()

  const routedTabIds = computed(() => [
    ...tabs.entries(),
  ].filter(([, t]) => t.routed).map(([id]) => id))
  const routedCount = computed(() => routedTabIds.value.length)
  /** Where a Routed Tab should be delivered right now; null while the active Target cannot play. */
  const desiredTarget = computed(() => (player.canPlay ? player.targetId : null))

  function stateOf(tabId: number): TabRouting {
    let state = tabs.get(tabId)
    if (!state) {
      state = { volume: DEFAULT_TAB_VOLUME, routed: false }
      tabs.set(tabId, state)
    }
    return state
  }

  function tabVolume(tabId: number): number {
    return tabs.get(tabId)?.volume ?? DEFAULT_TAB_VOLUME
  }

  function isRouted(tabId: number): boolean {
    return tabs.get(tabId)?.routed ?? false
  }

  /** Tab Volume × master, the absolute 0–100 level the Target receives, by the same rule as a Scene item. */
  function effectiveLevel(tabId: number): number {
    return Math.round(playback.computeVolume(tabVolume(tabId)) * 100)
  }

  function applyLevel(tabId: number): void {
    const session = sessions.get(tabId)
    if (!session)
      return
    const effective = effectiveLevel(tabId)
    logDebug(`[browser] tab ${tabId} level ${effective} (tab ${tabVolume(tabId)} × master ${playback.masterVolume}) on ${session.targetId}`)
    session.setLevel(effective)
  }

  function setTabVolume(tabId: number, volume: number): void {
    stateOf(tabId).volume = Math.min(100, Math.max(0, Math.round(volume)))
    applyLevel(tabId)
  }

  async function openDiscordSession(tabId: number, guildId: string, mediaSourceId: string): Promise<RoutingSession> {
    const streamId = `browser-${tabId}`
    await startEffectStream(guildId, streamId, effectiveLevel(tabId))
    let stream: MediaStream | undefined
    let capture: Awaited<ReturnType<typeof captureFromMediaStream>>
    try {
      stream = await captureTabStream(mediaSourceId)
      capture = await captureFromMediaStream(stream, pcm => sendEffectChunk(guildId, pcm, streamId))
    }
    catch (err) {
      // A failed worklet setup hands back no session, so the tab would stay
      // "being captured" until GC unless its tracks are stopped here.
      if (stream) {
        stream.getTracks().forEach(track => track.stop())
        console.warn(`[browser] tab ${tabId} capture setup on ${guildId} failed, tracks stopped`)
      }
      stopEffectStream(guildId, streamId).catch(() => {})
      throw err
    }
    return {
      targetId: guildId,
      setLevel: (effective) => {
        setEffectStreamVolume(guildId, streamId, effective).catch((err) => {
          console.error(`[browser] could not set the volume of stream ${streamId}:`, err)
        })
      },
      stop: async () => {
        capture.stop()
        await stopEffectStream(guildId, streamId).catch((err) => {
          console.error(`[browser] could not stop stream ${streamId}:`, err)
        })
      },
    }
  }

  async function openLocalSession(tabId: number, mediaSourceId: string): Promise<RoutingSession> {
    const stream = await captureTabStream(mediaSourceId)
    let local: Awaited<ReturnType<typeof createRoutedTabLocalPlayback>>
    try {
      local = await createRoutedTabLocalPlayback(stream, effectiveLevel(tabId) / 100)
    }
    catch (err) {
      stream.getTracks().forEach(track => track.stop())
      throw err
    }
    try {
      await setBrowserViewAudioMuted(tabId, true)
    }
    catch (err) {
      local.stop()
      throw err
    }
    return {
      targetId: LOCAL_TARGET_ID,
      setLevel: effective => local.setLevel(effective / 100),
      stop: async () => {
        local.stop()
        await setBrowserViewAudioMuted(tabId, false).catch((err) => {
          console.error(`[browser] could not unmute tab ${tabId}:`, err)
        })
      },
    }
  }

  async function openSession(tabId: number, targetId: string): Promise<RoutingSession> {
    const mediaSourceId = await getBrowserViewMediaSourceId(tabId)
    return targetId === LOCAL_TARGET_ID
      ? openLocalSession(tabId, mediaSourceId)
      : openDiscordSession(tabId, targetId, mediaSourceId)
  }

  async function reconcile(tabId: number): Promise<void> {
    const wanted = isRouted(tabId)
      ? desiredTarget.value
      : null
    const current = sessions.get(tabId)
    if (current?.targetId === wanted)
      return
    if (current) {
      sessions.delete(tabId)
      logInfo(`[browser] tab ${tabId} stops on ${current.targetId}`)
      await current.stop()
    }
    if (!wanted) {
      if (isRouted(tabId))
        logInfo(`[browser] tab ${tabId} stays routed and will resume once the Target can play`)
      return
    }
    try {
      const session = await openSession(tabId, wanted)
      sessions.set(tabId, session)
      logInfo(`[browser] tab ${tabId} routed to ${wanted} at level ${effectiveLevel(tabId)}`)
    }
    catch (err) {
      console.error(`[browser] could not route tab ${tabId} to ${wanted}:`, err)
      stateOf(tabId).routed = false
    }
  }

  /** Serialises reconciliation per tab so a fast toggle or a handover mid-start cannot interleave. */
  function sync(tabId: number): Promise<void> {
    const queued = (syncQueues.get(tabId) ?? Promise.resolve()).then(() => reconcile(tabId))
    syncQueues.set(tabId, queued)
    return queued.finally(() => {
      if (syncQueues.get(tabId) === queued)
        syncQueues.delete(tabId)
    })
  }

  function setRouted(tabId: number, routed: boolean): Promise<void> {
    logInfo(`[browser] tab ${tabId} ${routed ? 'route' : 'un-route'} requested (active Target ${player.targetId}, can play: ${player.canPlay})`)
    stateOf(tabId).routed = routed
    trackUsage({
      name: 'routed-tab-toggle',
      data: { routed, target: player.activeTarget },
    })
    return sync(tabId)
  }

  function toggleRouting(tabId: number): Promise<void> {
    return setRouted(tabId, !isRouted(tabId))
  }

  /** The tab is gone: end its routing and drop its Tab Volume. */
  async function forgetTab(tabId: number): Promise<void> {
    if (!tabs.has(tabId))
      return
    stateOf(tabId).routed = false
    await sync(tabId)
    tabs.delete(tabId)
  }

  watch(desiredTarget, (next, previous) => {
    if (routedTabIds.value.length === 0)
      return
    logInfo(`[browser] Target ${previous ?? 'none'} -> ${next ?? 'none'}, re-routing ${routedTabIds.value.length} tab(s)`)
    for (const tabId of routedTabIds.value)
      sync(tabId)
  })

  watch(() => playback.masterVolume, () => {
    for (const tabId of sessions.keys())
      applyLevel(tabId)
  })

  return {
    routedCount,
    tabVolume,
    isRouted,
    effectiveLevel,
    setTabVolume,
    setRouted,
    toggleRouting,
    forgetTab,
  }
})
