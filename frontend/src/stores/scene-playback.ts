import type { OutputTargetKind } from '@/api/config'
import type { Scene, SceneItem } from '@/api/scenes'
import type { SoundFile } from '@/api/sounds'
import type { CaptureSession } from '@/audio/browser-audio-capture'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import {
  sendAudioChunk,
  sendEffectChunk,
  startAudioStream,
  startEffectStream,
  stopAudioStream,
  stopEffectStream,
} from '@/api/audio-stream'
import { fetchMasterVolume, fetchSceneFadeLength, updateMasterVolume } from '@/api/config'
import {
  playAmbience as playBackendAmbience,
  playEffect as playBackendEffect,
  playMusic as playBackendMusic,
  setAmbienceVolume as setBackendAmbienceVolume,
  setMusicVolume as setBackendMusicVolume,
  stopAmbience as stopBackendAmbience,
  stopEffects as stopBackendEffects,
  stopMusic as stopBackendMusic,
} from '@/api/player'
import { getScene } from '@/api/scenes'
import { canDecode, soundStreamUrl } from '@/api/sounds'
import { logInfo, waitForPlayable, watchAudioElement } from '@/audio/audio-element-diagnostics'
import { selectBackendPlaybackPath } from '@/audio/backend-playback-path'
import {
  captureFromAudioElement,
  releaseAudioElementContext,
} from '@/audio/browser-audio-capture'
import { CrossfadeRamp } from '@/audio/crossfade-ramp'
import { bindAudioElement } from '@/audio/output-device'
import { useFlashSet } from '@/composables/useFlashSet'
import { usePlayerStore } from '@/stores/player'

export const SCENE_START_FLASH = 'start'

// Matches DEFAULT_SCENE_FADE_LENGTH_SECONDS (src/config/scene-fade-settings.ts)
// — used only if fetching the configured fade length fails outright.
const DEFAULT_CROSSFADE_FALLBACK_SECONDS = 3

// A sound's backend-decodability depends only on its (immutable) file
// format, never on when/how it's played, so this is safe to cache for the
// id's whole lifetime — avoids an IPC round-trip on every single Play click
// and every per-track Scene Crossfade switch.
function createDecodeCache(category: 'music' | 'ambience' | 'effects'): (soundId: string) => Promise<boolean> {
  const cache = new Map<string, Promise<boolean>>()
  return (soundId: string) => {
    let cached = cache.get(soundId)
    if (!cached) {
      cached = canDecode(category, soundId).catch(() => false)
      cache.set(soundId, cached)
    }
    return cached
  }
}

// Scene Crossfade (see CONTEXT.md): music needs two long-lived elements used
// alternately, because capturing an element for Discord permanently binds it
// to a MediaElementAudioSourceNode — the outgoing track must stay audible
// (and streamable) while the incoming track starts on the other channel.
// `primaryMusicChannel` is whichever channel holds the latest requested
// track; it never points at a channel that's mid fade-out.
// A 'backend' channel doesn't use `el`/`streamId` at all (see ADR-0003): the
// backend decodes the file straight into the mixer and owns its own
// crossfade, so this channel slot exists only to track which soundId/mode is
// "primary" for Stop/volume-slider bookkeeping.
interface MusicChannel {
  el: HTMLAudioElement
  streamId: string
  soundId: string | null
  source: 'renderer' | 'backend' | null
}

function createAudioEl(): HTMLAudioElement {
  const el = new Audio()
  el.crossOrigin = 'anonymous'
  bindAudioElement(el)
  return watchAudioElement(el)
}

function musicFadeKey(channel: MusicChannel): string {
  return `music:${channel.streamId}`
}
function ambienceFadeKey(soundId: string): string {
  return `ambience:${soundId}`
}

/**
 * Scene orchestration that has to outlive `SceneView.vue` (a Hotkey fires while
 * the renderer may be on any route): playing/stopping a Scene, Scene Crossfade,
 * single Ambience/Effect triggers, and the renderer-fallback bookkeeping
 * (music channels, ambience/effect `<audio>` elements, capture sessions).
 * Every action is addressed to the active Output Target, read from the player
 * store — callers never pass one.
 */
export const useScenePlaybackStore = defineStore('scenePlayback', () => {
  const player = usePlayerStore()

  // The Scene open in the Scene view, kept in sync by the view; only used to
  // resolve per-item volumes when the master volume moves, and to skip a fetch
  // when a Target handover restarts the Scene that is already open.
  const openScene = shallowRef<Scene | null>(null)
  const musicSounds = ref<SoundFile[]>([])
  const masterVolume = ref(80)
  const playingMusicId = ref<string | null>(null)
  const playingAmbienceIds = ref(new Set<string>())
  const effectFlash = useFlashSet()
  const sceneTransitionFlash = useFlashSet()

  const ambienceAudioEls = new Map<string, HTMLAudioElement>()
  const captureSessions = new Map<string, CaptureSession>()
  const canDecodeMusicCached = createDecodeCache('music')
  const canDecodeAmbienceCached = createDecodeCache('ambience')
  const canDecodeEffectsCached = createDecodeCache('effects')
  const ambienceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const targetId = computed(() => player.targetId)
  const canPlay = computed(() => player.canPlay)

  // Which path started each currently-audible ambience id — 'backend' (ADR-0003)
  // is decoded straight into the mixer; 'renderer' is the fallback for a file
  // with no backend decoder (an audio element, captured and streamed to a
  // Discord Target, or the output itself under the Local Target).
  const ambienceSource = new Map<string, 'renderer' | 'backend'>()
  // soundIds with an in-flight playAmbience/stopAmbience IPC call on the
  // backend — the getState()-sync watcher below must not resync one of these
  // from a player:stateChanged push that races ahead of (for a play) or
  // behind (for a stop) our own call actually taking effect there.
  const pendingBackendAmbienceCalls = new Set<string>()

  const musicChannels: MusicChannel[] = [
    { el: createAudioEl(), streamId: 'music-a', soundId: null, source: null },
    { el: createAudioEl(), streamId: 'music-b', soundId: null, source: null },
  ]
  let primaryMusicChannel = musicChannels[0]
  const crossfadeRamp = new CrossfadeRamp()

  function getAmbienceAudio(soundId: string): HTMLAudioElement {
    let el = ambienceAudioEls.get(soundId)
    if (!el) {
      el = createAudioEl()
      ambienceAudioEls.set(soundId, el)
    }
    return el
  }

  /** Tears down a renderer-tracked Effect Instance's `<audio>` element, capture session (if any) and chunked-IPC stream (if remote) — passed to the store as the instance's `stop` callback, called exactly once whether triggered by natural end, cap eviction, or an explicit Stop. */
  function teardownEffectAudioEl(id: string, el: HTMLAudioElement, remote: boolean) {
    el.onended = null
    el.onerror = null
    el.pause()
    el.removeAttribute('src')
    el.load()
    const sess = captureSessions.get(id)
    if (sess) {
      sess.stop()
      captureSessions.delete(id)
    }
    releaseAudioElementContext(el)
    if (remote && targetId.value)
      stopEffectStream(targetId.value, id).catch(() => {})
  }

  /** Stops every Effect instance on the active Target, regardless of path: renderer-tracked (fallback) instances via the store, and any backend-decoded ones (ADR-0003, which keeps its own cap independently of the renderer-side cap) via the backend. */
  function stopAllEffectInstances() {
    player.removeAllRendererEffectInstances()
    if (targetId.value)
      stopBackendEffects(targetId.value).catch(() => {})
  }

  function computeVolume(itemVolume: number): number {
    return (itemVolume / 100) * (masterVolume.value / 100)
  }

  function updateAmbienceVolume(item: SceneItem) {
    if (ambienceSource.get(item.soundId) === 'backend') {
      if (targetId.value)
        setBackendAmbienceVolume(targetId.value, item.soundId, computeVolume(item.volume ?? 80) * 100).catch(() => {})
      return
    }
    const el = ambienceAudioEls.get(item.soundId)
    if (el)
      el.volume = computeVolume(item.volume ?? 80)
  }

  function updateMusicVolume(item: SceneItem) {
    if (primaryMusicChannel.soundId !== item.soundId)
      return
    if (primaryMusicChannel.source === 'backend') {
      if (targetId.value)
        setBackendMusicVolume(targetId.value, computeVolume(item.volume ?? 80) * 100).catch(() => {})
    }
    else {
      primaryMusicChannel.el.volume = computeVolume(item.volume ?? 80)
    }
  }

  function updateAllVolumes() {
    if (!openScene.value)
      return
    for (const item of openScene.value.ambience)
      updateAmbienceVolume(item)
    const musicItem = openScene.value.music.find(m => m.soundId === playingMusicId.value)
    if (musicItem)
      updateMusicVolume(musicItem)
  }

  watch(masterVolume, () => updateAllVolumes())

  /** Loads the active Output Target's persisted master volume (`src/config/output-target-settings.ts`), instead of always starting back at the ref's default. */
  async function loadGlobalVolume() {
    masterVolume.value = await fetchMasterVolume(targetId.value).catch(() => masterVolume.value)
  }

  /** Persists the master volume slider's current position for the active Target; fired on `change` (drag release), not on every `input` tick. */
  function saveGlobalVolume() {
    updateMasterVolume(targetId.value, masterVolume.value).catch(() => {})
  }

  // getState() reports active backend-decoded Ambience sounds per guild (see
  // ADR-0003), so the pulse/toggle state here stays correct even when it
  // wasn't this component's own playAmbience() call that started it —
  // mirrors how nowPlayingLabel prefers the backend-reported Music track.
  // `pendingBackendAmbienceCalls` guards both directions of the same race: a
  // stale backend-reported soundId (one we just told the backend to stop)
  // resurrecting here, or a soundId we just told the backend to play being
  // prematurely dropped — either way because an unrelated sound's
  // player:stateChanged push raced ahead of our own call actually landing.
  watch(() => player.activeTargetState?.ambience, (ids) => {
    const backendIds = new Set(ids ?? [])
    for (const soundId of backendIds) {
      if (pendingBackendAmbienceCalls.has(soundId))
        continue
      if (!playingAmbienceIds.value.has(soundId)) {
        playingAmbienceIds.value.add(soundId)
        ambienceSource.set(soundId, 'backend')
      }
    }
    for (const soundId of [...playingAmbienceIds.value]) {
      if (pendingBackendAmbienceCalls.has(soundId))
        continue
      if (ambienceSource.get(soundId) === 'backend' && !backendIds.has(soundId)) {
        playingAmbienceIds.value.delete(soundId)
        ambienceSource.delete(soundId)
      }
    }
  })

  function toggleAmbience(item: SceneItem) {
    if (item.enabled && canPlay.value && targetId.value)
      playAmbience(item)
    else
      stopAmbience(item.soundId)
  }

  function stopAmbience(soundId: string, fadeOutMs = 0) {
    crossfadeRamp.cancel(ambienceFadeKey(soundId))
    playingAmbienceIds.value.delete(soundId)
    const source = ambienceSource.get(soundId)
    ambienceSource.delete(soundId)
    const timer = ambienceTimers.get(soundId)
    if (timer != null) {
      clearTimeout(timer)
      ambienceTimers.delete(soundId)
    }
    if (source === 'backend') {
      // Backend-decoded (ADR-0003): no audio element/chunked IPC to tear
      // down here — GuildAudioManager owns the fade and the stream.
      if (targetId.value) {
        pendingBackendAmbienceCalls.add(soundId)
        stopBackendAmbience(targetId.value, soundId, fadeOutMs > 0 ? { fadeOutMs } : {})
          .catch(() => {})
          .finally(() => pendingBackendAmbienceCalls.delete(soundId))
      }
      return
    }
    const el = ambienceAudioEls.get(soundId)
    if (el) {
      el.onended = null
      el.pause()
      el.removeAttribute('src')
      el.load()
    }
    const sess = captureSessions.get(`ambience-${soundId}`)
    if (sess) {
      sess.stop()
      captureSessions.delete(`ambience-${soundId}`)
    }
    // Under the Local Target the element is the output; nothing was streamed.
    if (!player.isLocalActive && targetId.value)
      stopEffectStream(targetId.value, `ambience-${soundId}`).catch(() => {})
  }

  function isLooping(item: SceneItem): boolean {
    return (item.repeatMin ?? 0) === 0 && (item.repeatMax ?? 0) === 0
  }

  // Backend-decoded path (see ADR-0003): the file is decoded straight into
  // the mixer in the main process, including the random repeat-interval
  // restart, so there's no audio element/chunked IPC or `ambienceTimers`
  // entry here — the backend owns its own fade-in, driven by `fadeInMs`.
  // Swallows its own failure (logged, like the renderer path's own catch)
  // rather than throwing, so callers never need a try/catch around it.
  async function playAmbienceBackend(item: SceneItem, fadeInMs: number) {
    if (!targetId.value)
      return
    // A sound's backend-decodability is immutable, so a renderer-sourced entry
    // for the same id can only be a leftover; stop it first or it would keep
    // playing, orphaned.
    const previousSource = ambienceSource.get(item.soundId)
    if (previousSource === 'renderer')
      stopAmbience(item.soundId)
    ambienceSource.set(item.soundId, 'backend')
    playingAmbienceIds.value.add(item.soundId)
    pendingBackendAmbienceCalls.add(item.soundId)
    try {
      await playBackendAmbience(targetId.value, item.soundId, {
        volume: computeVolume(item.volume ?? 80) * 100,
        repeatMin: item.repeatMin ?? 0,
        repeatMax: item.repeatMax ?? 0,
        fadeInMs,
      })
    }
    catch (e) {
      console.error('[scene] playAmbienceBackend failed:', e)
      // GuildAudioManager.playAmbience leaves a replaced sound fully
      // untouched on a failed decode — if this call was replacing an
      // already-playing backend sound, bookkeeping here is already
      // correctly still 'backend' (matching what's actually still audible)
      // and must NOT be cleared, or a subsequent stop/volume action would
      // have nothing to reach. Only a fresh start (nothing of ours was
      // playing before) should fully roll back.
      if (previousSource !== 'backend') {
        ambienceSource.delete(item.soundId)
        playingAmbienceIds.value.delete(item.soundId)
      }
    }
    finally {
      pendingBackendAmbienceCalls.delete(item.soundId)
    }
  }

  async function playAmbience(item: SceneItem, initialVolume?: number, fadeInMs = 0) {
    if (!targetId.value || !canPlay.value)
      return
    const path = selectBackendPlaybackPath(await canDecodeAmbienceCached(item.soundId))
    if (path === 'backend') {
      // Its own try/catch never rethrows (see above) — unlike the renderer
      // path below, a failure here must never reach the generic catch's
      // stopAmbience() call, which could stop a different, still-good
      // backend sound this call was merely trying to replace.
      await playAmbienceBackend(item, fadeInMs)
      return
    }
    // Renderer fallback: captured and streamed to a Discord Target, or the
    // output itself under the Local Target (ADR-0004).
    const streamed = !player.isLocalActive
    const target = targetId.value
    try {
      stopAmbience(item.soundId)
      const el = getAmbienceAudio(item.soundId)
      const streamId = `ambience-${item.soundId}`
      logInfo(`[scene] playAmbience ${item.soundId} via renderer fallback (${streamed ? 'streamed to Discord' : 'local'})`)
      if (streamed)
        await startEffectStream(target, streamId)
      el.src = soundStreamUrl('ambience', item.soundId)
      el.loop = isLooping(item)
      el.volume = initialVolume ?? computeVolume(item.volume ?? 80)
      el.load()
      await waitForPlayable(el, `ambience ${item.soundId} (renderer fallback)`)
      if (streamed) {
        const onChunk = (chunk: ArrayBuffer) => sendEffectChunk(target, chunk, streamId)
        const sess = await captureFromAudioElement(el, onChunk)
        captureSessions.set(`ambience-${item.soundId}`, sess)
      }

      if (!el.loop) {
        el.onended = () => {
          const min = (item.repeatMin ?? 0) * 1000
          const max = (item.repeatMax ?? 0) * 1000
          const delay = min + Math.random() * (max - min)
          const timer = setTimeout(() => {
            ambienceTimers.delete(item.soundId)
            el.currentTime = 0
            el.play().catch(() => {})
          }, delay)
          ambienceTimers.set(item.soundId, timer)
        }
      }

      await el.play()
      playingAmbienceIds.value.add(item.soundId)
      ambienceSource.set(item.soundId, 'renderer')
    }
    catch (e) {
      console.error('[scene] playAmbience failed:', e)
      stopAmbience(item.soundId)
    }
  }

  function clearMusicChannel(channel: MusicChannel) {
    channel.soundId = null
    channel.source = null
    if (primaryMusicChannel === channel)
      playingMusicId.value = null
  }

  // Fully tears down one music channel: cancels any crossfade ramp targeting
  // it, then either stops the backend-decoded track or the element/capture
  // session/stream for the renderer fallback. Safe to call on an idle channel —
  // used both for ordinary Stop and to free up a channel a crossfade needs to
  // reuse, even mid fade. `fadeOutMs` only applies to the backend path (the
  // renderer paths are cut immediately here; their own fades, if any, are
  // driven externally via `crossfadeRamp` before this runs).
  function stopMusicChannel(channel: MusicChannel, mode: 'renderer' | 'backend', fadeOutMs = 0) {
    crossfadeRamp.cancel(musicFadeKey(channel))
    if (mode === 'backend') {
      if (targetId.value)
        stopBackendMusic(targetId.value, fadeOutMs > 0 ? { fadeOutMs } : {}).catch(() => {})
      clearMusicChannel(channel)
      return
    }
    channel.el.onended = null
    channel.el.onerror = null
    channel.el.pause()
    channel.el.removeAttribute('src')
    channel.el.load()
    const sess = captureSessions.get(channel.streamId)
    if (sess) {
      sess.stop()
      captureSessions.delete(channel.streamId)
    }
    // Under the Local Target the element is the output; nothing was streamed.
    if (!player.isLocalActive && targetId.value)
      stopAudioStream(targetId.value, channel.streamId).catch(() => {})
    clearMusicChannel(channel)
  }

  // Backend-decoded path (see ADR-0003): the file is decoded straight into the
  // mixer in the main process, so there's no audio element/chunked IPC here —
  // the backend owns its own crossfade (fading the previous track out while
  // this one fades in), driven by `fadeInMs`.
  async function playMusicBackend(item: SceneItem, channel: MusicChannel, fadeInMs: number) {
    if (!targetId.value)
      return
    if (channel.source && channel.source !== 'backend')
      stopMusicChannel(channel, channel.source)
    channel.soundId = item.soundId
    channel.source = 'backend'
    if (channel === primaryMusicChannel)
      playingMusicId.value = item.soundId
    await playBackendMusic(targetId.value, item.soundId, {
      volume: computeVolume(item.volume ?? 80) * 100,
      loop: item.loop ?? false,
      fadeInMs,
    })
  }

  async function playMusic(item: SceneItem, channel: MusicChannel = primaryMusicChannel, initialVolume?: number, fadeInMs?: number) {
    if (!targetId.value || !canPlay.value)
      return
    try {
      const track = musicSounds.value.find(s => s.id === item.soundId)
      if (!track) {
        // Matches today's behaviour for a Scene Music item whose sound was
        // deleted from the library: silence whatever this channel was
        // playing rather than leaving it running underneath a Play action
        // that's about to no-op.
        if (channel.source)
          stopMusicChannel(channel, channel.source)
        return
      }

      const path = selectBackendPlaybackPath(await canDecodeMusicCached(item.soundId))
      if (path === 'backend') {
        await playMusicBackend(item, channel, fadeInMs ?? 0)
        return
      }

      // Renderer fallback: captured and streamed to a Discord Target, or the
      // output itself under the Local Target (ADR-0004).
      const streamed = !player.isLocalActive
      const target = targetId.value
      if (channel.source)
        stopMusicChannel(channel, channel.source)
      channel.soundId = item.soundId
      channel.source = 'renderer'
      if (channel === primaryMusicChannel)
        playingMusicId.value = item.soundId
      logInfo(`[scene] playMusic ${item.soundId} via renderer fallback (${streamed ? 'streamed to Discord' : 'local'}) on channel ${channel.streamId}`)
      if (streamed) {
        await startAudioStream(target, {
          id: track.id,
          name: track.name,
          filename: track.filename,
          category: 'music',
        }, channel.streamId)
      }
      const el = channel.el
      el.src = soundStreamUrl('music', item.soundId)
      el.loop = item.loop ?? false
      el.volume = initialVolume ?? computeVolume(item.volume ?? 80)
      el.load()
      await waitForPlayable(el, `music ${item.soundId} (renderer fallback)`)
      if (streamed) {
        const onChunk = (chunk: ArrayBuffer) => sendAudioChunk(target, chunk, channel.streamId)
        const sess = await captureFromAudioElement(el, onChunk)
        captureSessions.set(channel.streamId, sess)
      }
      el.onended = () => clearMusicChannel(channel)
      el.onerror = () => clearMusicChannel(channel)
      await el.play()
    }
    catch (e) {
      console.error('[scene] playMusic failed:', e)
      clearMusicChannel(channel)
    }
  }

  function stopMusic() {
    for (const channel of musicChannels) {
      if (channel.source)
        stopMusicChannel(channel, channel.source)
    }
  }

  // The inline per-track Stop button in the Music section: stops whichever
  // track the primary channel is actually playing.
  function stopMusicPlayback() {
    if (primaryMusicChannel.source)
      stopMusicChannel(primaryMusicChannel, primaryMusicChannel.source)
  }

  // Backend-decoded path (see ADR-0003): the file is decoded straight into
  // the mixer in the main process, so there's no audio element/chunked IPC
  // here. Every trigger is its own instance (never replacing another), with
  // its own cap of 8 kept independently by the backend — overlap parity with
  // the renderer's own Effect cap (#408), just enforced on the other side. The
  // started instance itself is reported to the store via `getState()`'s
  // `effects` field and the resulting `stateChanged` push (#509), not by
  // registering it here from the resolved call.
  async function playEffectBackend(item: SceneItem): Promise<void> {
    if (!targetId.value)
      return
    await playBackendEffect(targetId.value, item.soundId, {
      volume: computeVolume(item.volume ?? 80) * 100,
    })
  }

  async function playEffect(item: SceneItem) {
    if (!targetId.value || !canPlay.value)
      return
    effectFlash.trigger(item.soundId)

    const path = selectBackendPlaybackPath(await canDecodeEffectsCached(item.soundId))
    if (path === 'backend') {
      try {
        await playEffectBackend(item)
      }
      catch (e) {
        console.error('[scene] playEffectBackend failed:', e)
      }
      return
    }

    // Renderer fallback: captured and streamed to a Discord Target, or the
    // output itself under the Local Target (ADR-0004).
    const streamed = !player.isLocalActive
    const target = targetId.value
    const el = createAudioEl()
    const id = player.registerRendererEffectInstance(item.soundId, () => teardownEffectAudioEl(id, el, streamed))
    logInfo(`[scene] playEffect ${item.soundId} via renderer fallback (${streamed ? 'streamed to Discord' : 'local'}) as ${id}`)
    try {
      if (streamed)
        await startEffectStream(target, id)
      el.src = soundStreamUrl('effects', item.soundId)
      el.volume = (item.volume ?? 80) / 100 * (masterVolume.value / 100)
      el.load()
      await waitForPlayable(el, `effect ${item.soundId} (renderer fallback)`)
      if (Number.isFinite(el.duration))
        player.setEffectInstanceDuration(id, el.duration * 1000)
      if (streamed) {
        const onChunk = (chunk: ArrayBuffer) => sendEffectChunk(target, chunk, id)
        captureSessions.set(id, await captureFromAudioElement(el, onChunk))
      }
      el.onended = () => player.removeRendererEffectInstance(id)
      el.onerror = () => player.removeRendererEffectInstance(id)
      await el.play()
    }
    catch (e) {
      console.error('[scene] playEffect failed:', e)
      player.removeRendererEffectInstance(id)
    }
  }

  // A Scene that should restart on Discord as soon as a channel is joined — set
  // by a Target handover to Discord while no channel is connected.
  const pendingHandoverSceneId = ref<string | null>(null)

  async function playScene(target: Scene) {
    if (!canPlay.value || !targetId.value)
      return
    stopScene()
    player.setPlayingScene(target.id, targetId.value)
    logInfo(`[scene] play Scene ${target.id} on Target ${targetId.value}`)
    sceneTransitionFlash.trigger(SCENE_START_FLASH)
    try {
      for (const item of target.ambience.filter(a => a.enabled))
        await playAmbience(item)
      const firstMusic = target.music[0]
      if (firstMusic)
        await playMusic(firstMusic)
    }
    catch (e) {
      console.error('[scene] playScene failed:', e)
    }
  }

  // Tears down whatever is audible on the active Target right now
  // (`ambienceSource`/each music channel's `.source` are ground truth,
  // regardless of whether it got there via Play or an individual toggle), plus
  // the always-shared effect instances. Safe to call unconditionally wherever
  // playback must stop — the Stop button/row, deleting the playing Scene,
  // losing voice, and ambience/music toggled individually (never via Play)
  // when the GM leaves the open Scene.
  function stopScene() {
    pendingHandoverSceneId.value = null
    for (const soundId of [...playingAmbienceIds.value])
      stopAmbience(soundId)
    stopMusic()
    stopAllEffectInstances()
    player.clearPlayingScene()
  }

  // Hard handover (ADR-0004): stop everything on the old Target, then restart
  // the Playing Scene from the top on the new one — no cross-Target fade.
  async function restartHandoverScene(sceneToRestart: string) {
    try {
      const target = openScene.value?.id === sceneToRestart ? openScene.value : await getScene(sceneToRestart)
      if (target)
        await playScene(target)
    }
    catch (e) {
      console.error('[scene] Target handover could not restart the Scene:', e)
    }
  }

  async function switchTarget(kind: OutputTargetKind) {
    if (kind === player.activeTarget)
      return
    const playingId = player.playingSceneId
    logInfo(`[scene] switching Output Target ${player.activeTarget} -> ${kind}${playingId ? `, restarting Scene ${playingId}` : ''}`)
    stopScene()
    await player.setActiveTarget(kind)
    await loadGlobalVolume()
    if (!playingId)
      return
    if (!canPlay.value) {
      logInfo(`[scene] Scene ${playingId} will restart once a voice channel is joined`)
      pendingHandoverSceneId.value = playingId
      return
    }
    await restartHandoverScene(playingId)
  }

  watch(canPlay, (ok) => {
    const pending = pendingHandoverSceneId.value
    if (!ok || !pending)
      return
    pendingHandoverSceneId.value = null
    logInfo(`[scene] channel joined, restarting handed-over Scene ${pending}`)
    restartHandoverScene(pending)
  })

  // Scene Crossfade (see CONTEXT.md): ambience is already keyed per soundId
  // (one persistent element/stream regardless of which Scene asked for it), so
  // a sound present in both the outgoing and incoming Scene is simply never
  // stopped — only its volume ramp is retargeted. Anything no longer wanted
  // fades out and, once silent, is torn down exactly like a normal Stop.
  function crossfadeAmbience(target: Scene, durationMs: number) {
    const targetItems = new Map(target.ambience.filter(a => a.enabled).map(a => [a.soundId, a] as const))

    for (const soundId of [...playingAmbienceIds.value]) {
      const source = ambienceSource.get(soundId)
      if (!source || targetItems.has(soundId))
        continue
      if (source === 'backend') {
        // GuildAudioManager owns this sound's fade-out and stop (ADR-0003);
        // bookkeeping drops right away so a later switch never reconsiders it.
        if (targetId.value)
          stopBackendAmbience(targetId.value, soundId, durationMs > 0 ? { fadeOutMs: durationMs } : {}).catch(() => {})
        playingAmbienceIds.value.delete(soundId)
        ambienceSource.delete(soundId)
        continue
      }
      // Already on its way out from an earlier switch — let it finish; a
      // second Scene switch never resurrects or restarts an outgoing fade.
      if (crossfadeRamp.directionOf(ambienceFadeKey(soundId)) === 'out')
        continue
      const el = ambienceAudioEls.get(soundId)
      if (!el)
        continue
      crossfadeRamp.fade(ambienceFadeKey(soundId), {
        direction: 'out',
        from: el.volume,
        to: 0,
        durationMs,
        onVolume: (v) => { el.volume = v },
        onDone: () => stopAmbience(soundId),
      })
    }

    for (const item of targetItems.values()) {
      const to = computeVolume(item.volume ?? 80)
      const source = ambienceSource.get(item.soundId)
      const alreadyPlaying = playingAmbienceIds.value.has(item.soundId) && !!source
      if (alreadyPlaying) {
        if (source === 'backend') {
          // The shared-sound rule (CONTEXT.md): never restarted, just glided
          // to the new Scene's volume.
          if (targetId.value)
            setBackendAmbienceVolume(targetId.value, item.soundId, to * 100, durationMs > 0 ? { rampMs: durationMs } : {}).catch(() => {})
          continue
        }
        const el = ambienceAudioEls.get(item.soundId)
        if (!el)
          continue
        crossfadeRamp.fade(ambienceFadeKey(item.soundId), {
          direction: 'in',
          from: el.volume,
          to,
          durationMs,
          onVolume: (v) => { el.volume = v },
        })
      }
      else {
        // The backend path (ADR-0003) drives its own fade-in via fadeInMs; the
        // renderer fallback is ramped below.
        playAmbience(item, 0, durationMs).then(() => {
          if (ambienceSource.get(item.soundId) === 'backend')
            return
          crossfadeRamp.fade(ambienceFadeKey(item.soundId), {
            direction: 'in',
            from: 0,
            to,
            durationMs,
            onVolume: (v) => {
              const el = ambienceAudioEls.get(item.soundId)
              if (el)
                el.volume = v
            },
          })
        })
      }
    }
  }

  // Music has no "present in both Scenes" case to preserve — only ever one
  // outgoing and one incoming track — so the two long-lived channels simply
  // swap roles: the channel holding the outgoing track fades out and stops on
  // its own schedule, while the other channel (reused immediately, even if it
  // was still finishing an earlier fade-out) starts the incoming track at
  // volume 0 and ramps up. `primaryMusicChannel` flips to the incoming channel
  // right away, so it never points at a channel that's mid fade-out.
  function crossfadeMusic(target: Scene, durationMs: number) {
    const outgoingChannel = primaryMusicChannel
    const outgoingHadTrack = outgoingChannel.soundId != null
    const outgoingWasBackend = outgoingChannel.source === 'backend'
    const targetTrack = target.music[0]
    const incomingChannel = targetTrack ? (musicChannels.find(c => c !== outgoingChannel) ?? musicChannels[1]) : null

    if (incomingChannel) {
      primaryMusicChannel = incomingChannel
      // The backend path (ADR-0003) drives its own fade-in via fadeInMs.
      playMusic(targetTrack!, incomingChannel, 0, durationMs).then(() => {
        // playMusic swallows its own failures internally (console.error +
        // clearMusicChannel) rather than rejecting, so this always runs — a
        // failed start shows up as `incomingChannel` having been cleared back
        // to empty.
        if (incomingChannel.soundId !== targetTrack!.soundId) {
          // If the outgoing track is still alive on the backend (preserved on
          // purpose below), restore it as primary so Stop/volume controls can
          // reach it again instead of leaving it reachable only on the
          // backend with no surviving UI handle.
          if (outgoingHadTrack && outgoingWasBackend) {
            primaryMusicChannel = outgoingChannel
            playingMusicId.value = outgoingChannel.soundId
          }
          return
        }
        if (incomingChannel.source === 'backend') {
          // The backend already faded the previous backend track out (and
          // stopped it) as a side effect of this call succeeding, but only
          // when the OUTGOING track was also backend-sourced — see
          // GuildAudioManager.playMusic, which only knows about its own prior
          // backend track. Only drop the renderer's own bookkeeping for it
          // once we know that actually happened.
          if (outgoingHadTrack && outgoingWasBackend)
            clearMusicChannel(outgoingChannel)
        }
        else {
          crossfadeRamp.fade(musicFadeKey(incomingChannel), {
            direction: 'in',
            from: 0,
            to: computeVolume(targetTrack!.volume ?? 80),
            durationMs,
            onVolume: (v) => { incomingChannel.el.volume = v },
          })
          // A mixed-path switch (outgoing was backend-decoded, incoming falls
          // back to the renderer, e.g. a backend-decodable track followed by
          // an m4a one): the backend was never told about this crossfade at
          // all, so nothing else will stop the previous backend track —
          // fade/stop it directly here instead of leaving it orphaned.
          if (outgoingHadTrack && outgoingWasBackend)
            stopMusicChannel(outgoingChannel, 'backend', durationMs)
        }
      })
    }
    else {
      playingMusicId.value = null
    }

    // Renderer outgoing fade: unconditional on the incoming track's success,
    // exactly as before 'backend' existed — this is what guarantees the old
    // track always stops, never orphaned, regardless of whether the new one
    // took over.
    if (outgoingHadTrack && !outgoingWasBackend) {
      crossfadeRamp.fade(musicFadeKey(outgoingChannel), {
        direction: 'out',
        from: outgoingChannel.el.volume,
        to: 0,
        durationMs,
        onVolume: (v) => { outgoingChannel.el.volume = v },
        onDone: () => {
          // Re-check rather than trust the closed-over `outgoingWasBackend`:
          // by the time this fade completes, nothing should have changed the
          // channel's source out from under it, but a plain narrowing check is
          // cheap insurance against an unchecked cast silently papering over
          // whatever did.
          if (outgoingChannel.source && outgoingChannel.source !== 'backend')
            stopMusicChannel(outgoingChannel, outgoingChannel.source)
        },
      })
    }

    // Backend outgoing with no incoming track at all (switching to a
    // music-less Scene): nothing above will trigger its fade-out, so do it
    // directly. When there IS an incoming channel, the `.then()` above handles
    // it once the new track is confirmed to have started.
    if (outgoingHadTrack && outgoingWasBackend && !incomingChannel)
      stopMusicChannel(outgoingChannel, 'backend', durationMs)
  }

  // Entry point for Scene Crossfade (see CONTEXT.md): called instead of a hard
  // stop when the GM opens a different Scene while one is already playing. The
  // new Scene becomes the Playing Scene immediately; the configured fade
  // length then drives both channels' ramps (0 is a hard cut, handled by
  // CrossfadeRamp itself). Stays within the active Target.
  async function crossfadeToScene(sceneId: string) {
    let target: Scene | null
    try {
      target = await getScene(sceneId)
    }
    catch (e) {
      console.error('[scene] crossfadeToScene: failed to load target scene', e)
      return
    }
    if (!target)
      return
    const fadeSeconds = await fetchSceneFadeLength().catch(() => DEFAULT_CROSSFADE_FALLBACK_SECONDS)
    const durationMs = fadeSeconds * 1000
    player.setPlayingScene(target.id, targetId.value)
    sceneTransitionFlash.trigger(SCENE_START_FLASH)
    crossfadeAmbience(target, durationMs)
    crossfadeMusic(target, durationMs)
  }

  // Only react to the selected guild's own connection dropping — not to the GM
  // switching the sidebar selection to a different, not-yet-joined guild (which
  // also flips `isJoined` false but shouldn't stop another guild's playback).
  // The Local Target has no voice connection, so it never reacts to this.
  watch([() => player.guildId, () => player.isJoined], ([newGuildId, joined], [oldGuildId, wasJoined]) => {
    if (!player.isLocalActive && newGuildId === oldGuildId && wasJoined && !joined)
      stopScene()
  })

  return {
    openScene,
    musicSounds,
    masterVolume,
    playingMusicId,
    playingAmbienceIds,
    effectFlash,
    sceneTransitionFlash,
    loadMasterVolume: loadGlobalVolume,
    saveMasterVolume: saveGlobalVolume,
    computeVolume,
    updateAmbienceVolume,
    updateMusicVolume,
    toggleAmbience,
    stopAmbience,
    playAmbience,
    playMusic,
    stopMusicPlayback,
    playEffect,
    playScene,
    stopScene,
    switchTarget,
    crossfadeToScene,
    stopAllEffectInstances,
  }
})
