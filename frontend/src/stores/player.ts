import type { OutputTargetKind } from '@/api/config'
import type { BotStatus, GuildDirectoryEntry, PlayerStateItem } from '@/api/player'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { fetchActiveOutputTarget, LOCAL_TARGET_ID, updateActiveOutputTarget } from '@/api/config'
import {
  fetchBotStatus,
  fetchGuildDirectory,
  fetchPlayerState,
  joinChannel,
  leaveGuild,
  onPlayerStateChanged,
  reconnectBot,
  stopEffect as stopBackendEffectInstance,
} from '@/api/player'

/** Matches the backend's own cap (`EFFECT_INSTANCE_CAP`, `src/audio/guild-audio.manager.ts`, #408) — the renderer-tracked paths (Discord fallback, local preview) keep their own independent cap, enforced here. */
const RENDERER_EFFECT_CAP = 8

/**
 * One Effect Instance (#509), regardless of which path started it —
 * `origin` distinguishes a backend-decoded instance (synced from
 * `getState()`/`stateChanged`, see `syncBackendEffects`) from a
 * renderer-tracked one (the Discord-fallback or local-preview path,
 * registered directly by `SceneView.vue` via `registerRendererEffectInstance`).
 * `startedAt`/`durationMs` are both epoch milliseconds, so elapsed/remaining
 * can be computed from `Date.now()` without another IPC round-trip —
 * progress ticks on the renderer's own clock between `stateChanged` edges.
 */
interface EffectInstanceEntry {
  soundId: string
  startedAt: number
  durationMs: number
  origin: 'backend' | 'renderer'
  /** Renderer-origin only: tears down this instance's audio element/stream. Called exactly once, whether triggered by natural end, cap eviction, or an explicit stop. */
  stop?: () => void
}

export interface EffectSoundStatus {
  /** How many instances of this sound are currently active. */
  count: number
  /** Elapsed/total for the longest-remaining instance — the one that determines when the card goes idle. */
  elapsedMs: number
  totalMs: number
}

export const usePlayerStore = defineStore('player', () => {
  const playerState = ref<PlayerStateItem[]>([])
  const botStatus = ref<BotStatus | null>(null)
  const directory = ref<GuildDirectoryEntry[]>([])
  const directoryError = ref<string | null>(null)
  const guildId = ref('')
  const channelId = ref('')
  const channelJoinBusy = ref(false)
  const browserStreamingCount = ref(0)
  // The Scene started with Play/Stream, distinct from the open Scene — see
  // "Playing Scene" in CONTEXT.md. `scenePlaying` is kept as a computed for
  // existing readers (sidebar indicator, now-playing line). Mutate both
  // fields together via setPlayingScene/clearPlayingScene, never directly,
  // so "id set, mode null" can't happen.
  const playingSceneId = ref<string | null>(null)
  // The Output Target the Playing Scene is on: `LOCAL_TARGET_ID` or a guild id.
  const playingSceneMode = ref<string | null>(null)
  // Which Output Target the Scene view routes to (persisted via the `config` domain).
  const activeTarget = ref<OutputTargetKind>('discord')
  const isLocalActive = computed(() => activeTarget.value === 'local')
  const scenePlaying = computed(() => playingSceneId.value !== null)

  const selectedGuildState = computed(() =>
    playerState.value.find(g => g.guildId === guildId.value),
  )
  const isJoined = computed(() => !!selectedGuildState.value?.connectedChannelId)
  /** The id playback calls are addressed to: `LOCAL_TARGET_ID` while Local is active, else the selected guild. */
  const targetId = computed(() => (activeTarget.value === 'local' ? LOCAL_TARGET_ID : guildId.value))
  const activeTargetState = computed(() => playerState.value.find(g => g.guildId === targetId.value))
  /** Local plays with no voice connection; Discord needs a joined channel. */
  const canPlay = computed(() => activeTarget.value === 'local' || isJoined.value)

  // Effect Instances (#509) — a single reactive view merging backend-reported
  // instances (synced from playerState below) with renderer-tracked ones
  // (registered directly by SceneView for the Discord-fallback and
  // local-preview paths), keyed by instanceId. See `EffectInstanceEntry`.
  const effectInstances = ref(new Map<string, EffectInstanceEntry>())
  const effectTick = ref(Date.now())
  let effectTickTimer: ReturnType<typeof setInterval> | undefined
  let rendererEffectSeq = 0
  /** Backend-origin ids with a `stopEffect` call in flight: a stale `stateChanged` snapshot must not resurrect them via `syncBackendEffects`. Cleared once the call settles. */
  const pendingBackendStops = new Set<string>()

  function ensureEffectTicking() {
    if (effectTickTimer !== undefined)
      return
    effectTickTimer = setInterval(() => {
      effectTick.value = Date.now()
    }, 200)
  }

  function stopEffectTickingIfIdle() {
    if (effectInstances.value.size === 0 && effectTickTimer !== undefined) {
      clearInterval(effectTickTimer)
      effectTickTimer = undefined
    }
  }

  /** Replaces every backend-origin entry with the current guild's live Effect Instances; renderer-origin entries are untouched. Runs on every playerState update, so an instance starting or ending (played out, evicted, stopped) shows up as soon as the backend's `stateChanged` push lands. */
  function syncBackendEffects() {
    const live = activeTargetState.value
    const backendList = (live?.effects ?? []).filter(e => !pendingBackendStops.has(e.instanceId))
    const backendIds = new Set(backendList.map(e => e.instanceId))
    for (const [id, entry] of effectInstances.value) {
      if (entry.origin === 'backend' && !backendIds.has(id))
        effectInstances.value.delete(id)
    }
    for (const e of backendList) {
      effectInstances.value.set(e.instanceId, {
        soundId: e.soundId,
        startedAt: new Date(e.startedAt).getTime(),
        durationMs: e.durationMs,
        origin: 'backend',
      })
    }
    if (effectInstances.value.size > 0)
      ensureEffectTicking()
    else
      stopEffectTickingIfIdle()
  }

  /** Registers a new renderer-tracked (Discord-fallback or local-preview) Effect Instance, evicting the oldest renderer-tracked one first if already at the renderer-side cap — the backend enforces its own cap independently (overlap parity, #408). Returns the new instance's id. */
  function registerRendererEffectInstance(soundId: string, stop: () => void): string {
    const rendererIds = [...effectInstances.value.entries()]
      .filter(([, e]) => e.origin === 'renderer')
      .map(([id]) => id)
    while (rendererIds.length >= RENDERER_EFFECT_CAP) {
      const oldestId = rendererIds.shift()
      if (oldestId === undefined)
        break
      removeRendererEffectInstance(oldestId)
    }

    const id = `effect-${++rendererEffectSeq}`
    effectInstances.value.set(id, { soundId, startedAt: Date.now(), durationMs: 0, origin: 'renderer', stop })
    ensureEffectTicking()
    return id
  }

  /** Sets a renderer-tracked instance's known duration (read from its `<audio>` element once available) — a no-op once the instance has already ended or if it's backend-origin (that duration comes from `syncBackendEffects` instead). */
  function setEffectInstanceDuration(instanceId: string, durationMs: number): void {
    const entry = effectInstances.value.get(instanceId)
    if (!entry || entry.origin !== 'renderer')
      return
    effectInstances.value.set(instanceId, { ...entry, durationMs })
  }

  /** Tears down (if still registered) and removes one renderer-tracked Effect Instance. Idempotent — safe to call from natural end (`onended`), cap eviction, and an explicit stop alike. A no-op for an unknown or already-removed id. */
  function removeRendererEffectInstance(instanceId: string): void {
    const entry = effectInstances.value.get(instanceId)
    if (!entry)
      return
    effectInstances.value.delete(instanceId)
    if (entry.origin === 'renderer')
      entry.stop?.()
    stopEffectTickingIfIdle()
  }

  /** Tears down every renderer-tracked Effect Instance (Scene stop, leave, disconnect, Scene navigation) — backend-origin instances are cleared separately via the bulk `stopEffects` IPC call, which the caller is still responsible for. */
  function removeAllRendererEffectInstances(): void {
    for (const [id, entry] of [...effectInstances.value]) {
      if (entry.origin === 'renderer')
        removeRendererEffectInstance(id)
    }
  }

  /** Active-instance summary for one sound: how many are layered, and the elapsed/total for whichever instance will finish last (the one the card's fill/timer tracks) — or null while none of this sound are active. Reads `effectTick`, so it re-evaluates on the renderer's own clock between `stateChanged` edges rather than needing another backend round-trip. */
  function effectStatus(soundId: string): EffectSoundStatus | null {
    const tick = effectTick.value
    let longest: EffectInstanceEntry | null = null
    let longestRemaining = Number.NEGATIVE_INFINITY
    let count = 0
    for (const entry of effectInstances.value.values()) {
      if (entry.soundId !== soundId)
        continue
      count++
      const remaining = entry.durationMs - (tick - entry.startedAt)
      if (remaining > longestRemaining) {
        longestRemaining = remaining
        longest = entry
      }
    }
    if (!longest)
      return null
    const elapsedMs = Math.max(0, Math.min(longest.durationMs, tick - longest.startedAt))
    return { count, elapsedMs, totalMs: longest.durationMs }
  }

  /** Stops every active instance of `soundId`, across every path (backend-decoded and renderer-tracked alike) — the Effect card's Stop control. Backend-origin entries are dropped immediately rather than waiting for the backend's own `stateChanged` confirmation, so the card goes idle with no animation. */
  async function stopEffectSound(soundId: string): Promise<void> {
    const gid = targetId.value
    const backendIds: string[] = []
    const rendererIds: string[] = []
    for (const [id, entry] of effectInstances.value) {
      if (entry.soundId !== soundId)
        continue
      if (entry.origin === 'backend')
        backendIds.push(id)
      else
        rendererIds.push(id)
    }
    for (const id of rendererIds)
      removeRendererEffectInstance(id)
    for (const id of backendIds) {
      effectInstances.value.delete(id)
      pendingBackendStops.add(id)
    }
    stopEffectTickingIfIdle()
    if (gid) {
      await Promise.all(backendIds.map(async (id) => {
        try {
          await stopBackendEffectInstance(gid, id)
        }
        catch {
          // Logged by the IPC layer; the next playerState sync is the source of truth.
        }
        finally {
          pendingBackendStops.delete(id)
        }
      }))
    }
  }

  function setPlayingScene(id: string, target: string) {
    playingSceneId.value = id
    playingSceneMode.value = target
  }

  /** Clears the Playing Scene; with `target`, only if it is on that Target. */
  function clearPlayingScene(target?: string) {
    if (target === undefined || playingSceneMode.value === target) {
      playingSceneId.value = null
      playingSceneMode.value = null
    }
  }

  async function loadActiveTarget() {
    try {
      activeTarget.value = await fetchActiveOutputTarget()
    }
    catch (err) {
      // Outside Electron (tests, Vite dev) this is expected; keep the default.
      console.warn('[player] could not read the active Output Target, keeping the default:', err)
    }
  }

  /** Switches the active Output Target and persists it; callers own stopping playback on the old Target first. */
  async function setActiveTarget(kind: OutputTargetKind) {
    activeTarget.value = kind
    try {
      await updateActiveOutputTarget(kind)
    }
    catch (err) {
      console.error('[player] could not persist the active Output Target:', err)
    }
  }

  const channels = computed(() => {
    const guild = directory.value.find(entry => entry.guildId === guildId.value)
    return guild?.channels ?? []
  })

  watch([playerState, targetId], syncBackendEffects, { deep: true })
  const connectedGuildId = computed(() =>
    playerState.value.find(g => g.connectedChannelId)?.guildId ?? '',
  )

  async function loadState() {
    try {
      const botRes = await fetchBotStatus().catch(() => ({ ready: false } as BotStatus))
      botStatus.value = botRes

      const stateRes = await fetchPlayerState().catch(() => [] as PlayerStateItem[])
      playerState.value = stateRes
    }
    catch {
      // Expected when running outside Electron (e.g. tests or Vite dev)
    }
  }

  onPlayerStateChanged(() => {
    loadState()
  })

  function syncSelectionFromConnectedState() {
    const connected = playerState.value.find(g => g.connectedChannelId)
    if (!connected)
      return
    const guild = directory.value.find(g => g.guildId === connected.guildId)
    if (!guild || !guild.channels.some(c => c.id === connected.connectedChannelId))
      return
    if (guildId.value !== connected.guildId)
      guildId.value = connected.guildId
    if (channelId.value !== connected.connectedChannelId)
      channelId.value = connected.connectedChannelId!
  }

  async function loadDirectory() {
    directoryError.value = null
    try {
      const data = await fetchGuildDirectory()
      directory.value = data
      ensureChannelSelection()
    }
    catch (err) {
      directoryError.value
        = err instanceof Error ? err.message : 'Failed to load guilds'
    }
  }

  function ensureChannelSelection() {
    if (!channels.value.length) {
      channelId.value = ''
      return
    }
    const connectedId = selectedGuildState.value?.connectedChannelId
    if (connectedId && channels.value.some(c => c.id === connectedId)) {
      channelId.value = connectedId
      return
    }
    if (!channels.value.some(channel => channel.id === channelId.value))
      channelId.value = ''
  }

  async function selectChannel(gid: string, cid: string) {
    if (!gid || !cid)
      return
    guildId.value = gid
    channelId.value = cid
    const connected = selectedGuildState.value?.connectedChannelId
    if (connected === cid)
      return
    channelJoinBusy.value = true
    try {
      await joinChannel(gid, cid)
      await loadState()
    }
    finally {
      channelJoinBusy.value = false
    }
  }

  async function doLeave(gid?: string) {
    const targetGuildId = gid ?? guildId.value ?? connectedGuildId.value
    if (!targetGuildId)
      return
    await leaveGuild(targetGuildId)
    playerState.value = playerState.value.filter(g => g.guildId !== targetGuildId)
    if (guildId.value === targetGuildId)
      channelId.value = ''
  }

  const reconnecting = ref(false)

  async function doReconnect() {
    reconnecting.value = true
    try {
      await reconnectBot()
      playerState.value = []
      directory.value = []
      guildId.value = ''
      channelId.value = ''

      const deadline = Date.now() + 15_000
      while (Date.now() < deadline) {
        await loadState()
        if (botStatus.value?.ready)
          break
        await new Promise<void>(r => setTimeout(r, 1_000))
      }
      if (botStatus.value?.ready)
        await loadDirectory()
    }
    finally {
      reconnecting.value = false
    }
  }

  watch(
    () => botStatus.value?.ready,
    (ready, wasReady) => {
      if (ready && !wasReady)
        loadDirectory()
    },
  )

  watch(guildId, () => {
    ensureChannelSelection()
  })

  watch(
    () => selectedGuildState.value?.connectedChannelId,
    (connectedId) => {
      if (connectedId && channels.value.some(c => c.id === connectedId))
        channelId.value = connectedId
    },
  )

  watch(
    () => [playerState.value, directory.value] as const,
    () => {
      syncSelectionFromConnectedState()
    },
    { deep: true },
  )

  return {
    playerState,
    botStatus,
    directory,
    directoryError,
    guildId,
    channelId,
    channels,
    selectedGuildState,
    isJoined,
    activeTarget,
    isLocalActive,
    targetId,
    activeTargetState,
    canPlay,
    loadActiveTarget,
    setActiveTarget,
    channelJoinBusy,
    loadState,
    loadDirectory,
    selectChannel,
    doLeave,
    doReconnect,
    reconnecting,
    connectedGuildId,
    browserStreamingCount,
    playingSceneId,
    playingSceneMode,
    scenePlaying,
    setPlayingScene,
    clearPlayingScene,
    registerRendererEffectInstance,
    setEffectInstanceDuration,
    removeRendererEffectInstance,
    removeAllRendererEffectInstances,
    effectStatus,
    stopEffectSound,
  }
})
