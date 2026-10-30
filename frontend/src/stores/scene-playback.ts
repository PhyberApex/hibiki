import type { OutputTargetKind } from '@/api/config'
import type { MusicMode, Scene, SceneItem } from '@/api/scenes'
import type { SoundFile } from '@/api/sounds'
import type { CaptureSession } from '@/audio/browser-audio-capture'
import type { SelectedTrack } from '@/audio/music-mode'
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
  warmEffects,
} from '@/api/player'
import { getScene } from '@/api/scenes'
import { canDecode, soundStreamUrl } from '@/api/sounds'
import { trackUsage } from '@/api/usage-stats'
import { logDebug, logInfo, waitForPlayable, watchAudioElement } from '@/audio/audio-element-diagnostics'
import { selectBackendPlaybackPath } from '@/audio/backend-playback-path'
import {
  captureFromAudioElement,
  releaseAudioElementContext,
} from '@/audio/browser-audio-capture'
import { CrossfadeRamp } from '@/audio/crossfade-ramp'
import { normalizeMusicMode, selectFirstTrack, selectNextTrack, shuffleBagWithout } from '@/audio/music-mode'
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
// `token` identifies the start that put `soundId` there, so an end event can
// tell "this track played out" from "a track this channel used to hold"
// (Music Mode advance, ADR-0006). `backendTarget` is the Target a 'backend'
// track was confirmed started on; until then its end cannot be detected.
// `itemVolume` is the track's own 0-100 Scene item volume, before the master.
// `startedAt` (epoch ms, once the start is confirmed), `durationMs` (null when
// unknown) and `loop` drive the Music progress timer (#695).
interface MusicChannel {
  el: HTMLAudioElement
  streamId: string
  soundId: string | null
  source: 'renderer' | 'backend' | null
  token: number
  backendTarget: string | null
  itemVolume: number
  startedAt: number | null
  durationMs: number | null
  loop: boolean
}

export interface MusicProgress {
  soundId: string
  elapsedMs: number
  totalMs: number
}

// Where a Scene's Music Mode stands (CONTEXT.md, ADR-0006): the Scene the
// current track was started from, that track, its list index when picked, and
// the shuffle bag left for this pass.
interface MusicCursor {
  sceneId: string
  current: string
  index: number
  bag: string[]
  pass?: string[]
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

  // The Scene open in the Scene view, kept in sync by the view: the live copy
  // of a Scene for a Music Mode advance or a Target handover, and the list a
  // Music track's Play jumps within. Never used to resolve volumes: the Playing
  // Scene need not be the open one (#648).
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

  // Decodes a Scene's Effects into the backend's PCM cache in the background
  // (#696), so the first thunderclap lands as fast as the tenth. The backend
  // filters to backend-decodable Effects and logs the per-Scene outcome; the
  // cache is shared across Targets, so this needs no Target and never blocks
  // or fails playback.
  function warmSceneEffects(scene: Scene) {
    const soundIds = scene.effects.map(e => e.soundId)
    if (!soundIds.length)
      return
    // Through a resolved promise so a synchronous throw (no Electron bridge)
    // lands in the same catch as a rejected call.
    Promise.resolve()
      .then(() => warmEffects(scene.id, soundIds))
      .catch(e => console.warn(`[scene] warming Effects for Scene ${scene.id} failed:`, e))
  }

  // Keyed on the Effect list, not the Scene object: the view hands over a new
  // copy on every edit, and only a new Effect is worth another warm-up.
  watch(() => openScene.value?.effects.length
    ? `${openScene.value.id}\n${openScene.value.effects.map(e => e.soundId).join('\n')}`
    : null, (key) => {
    if (key && openScene.value)
      warmSceneEffects(openScene.value)
  })

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
  // The latest play or Stop of each soundId's Ambience. A start still awaiting
  // its decode probe, backend call or element load checks it after every
  // await: a newer token means it was overtaken, and `stopped` by which.
  const ambienceIntents = new Map<string, { token: number, stopped: boolean }>()
  let ambienceIntentSeq = 0
  // soundIds whose current start is still in flight, not yet in
  // `playingAmbienceIds`: a Scene Stop must reach them too.
  const startingAmbience = new Set<string>()
  // The 0-100 Scene item volume each audible or starting Ambience sound was
  // started with (or last edited to), so a master volume change can rescale it
  // whichever Scene it came from and whatever Scene is open.
  const ambienceItemVolumes = new Map<string, number>()

  const musicChannels: MusicChannel[] = [
    {
      el: createAudioEl(),
      streamId: 'music-a',
      soundId: null,
      source: null,
      token: 0,
      backendTarget: null,
      itemVolume: 80,
      startedAt: null,
      durationMs: null,
      loop: false,
    },
    {
      el: createAudioEl(),
      streamId: 'music-b',
      soundId: null,
      source: null,
      token: 0,
      backendTarget: null,
      itemVolume: 80,
      startedAt: null,
      durationMs: null,
      loop: false,
    },
  ]
  let primaryMusicChannel = musicChannels[0]
  const crossfadeRamp = new CrossfadeRamp()

  // The primary Music track's clock (#695), ticking on the renderer's own
  // clock like the Effect timers: null while nothing plays, the start is not
  // yet confirmed or the track's duration is unknown (no timer then).
  const musicClock = shallowRef<{ soundId: string, startedAt: number, durationMs: number, loop: boolean } | null>(null)
  const musicTick = ref(Date.now())
  let musicTickTimer: ReturnType<typeof setInterval> | undefined

  function syncMusicClock() {
    const channel = primaryMusicChannel
    musicClock.value = channel.soundId !== null && channel.startedAt !== null && channel.durationMs !== null
      ? {
          soundId: channel.soundId,
          startedAt: channel.startedAt,
          durationMs: channel.durationMs,
          loop: channel.loop,
        }
      : null
    if (musicClock.value && musicTickTimer === undefined) {
      musicTick.value = Date.now()
      musicTickTimer = setInterval(() => {
        musicTick.value = Date.now()
      }, 250)
    }
    else if (!musicClock.value && musicTickTimer !== undefined) {
      clearInterval(musicTickTimer)
      musicTickTimer = undefined
    }
  }

  // Elapsed / total of the playing Music track; a looping track wraps, any
  // other holds at its total until its end is reported.
  const musicProgress = computed<MusicProgress | null>(() => {
    const clock = musicClock.value
    if (!clock)
      return null
    const elapsed = Math.max(0, musicTick.value - clock.startedAt)
    return {
      soundId: clock.soundId,
      elapsedMs: clock.loop
        ? elapsed % clock.durationMs
        : Math.min(clock.durationMs, elapsed),
      totalMs: clock.durationMs,
    }
  })

  // Marks `channel`'s start confirmed now, with the duration it will run for.
  function startMusicClock(channel: MusicChannel, durationMs: number | null) {
    channel.startedAt = Date.now()
    channel.durationMs = durationMs
    logInfo(`[scene] Music ${channel.soundId} started on ${channel.streamId}, ${durationMs === null
      ? 'duration unknown, no timer'
      : `duration ${durationMs} ms`}`)
    syncMusicClock()
  }

  // Music Mode (ADR-0006). `musicSceneId` is the Scene the current Music track
  // was started from; the advance follows that Scene, Playing Scene or not.
  const musicSceneId = ref<string | null>(null)
  let musicCursor: MusicCursor | null = null
  let musicStartSeq = 0
  // Bumped whenever the GM takes over Music (Play, Stop, a Scene Crossfade, a
  // jump, a Target switch): an advance or skip chain started before then must
  // not start anything afterwards.
  let musicIntent = 0
  // Bumped by every Scene start, Stop and Scene Crossfade: a Scene start-up
  // still awaiting its Ambience must not start anything once overtaken.
  let sceneIntent = 0

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

  function applyAmbienceVolume(soundId: string, itemVolume: number) {
    if (ambienceSource.get(soundId) === 'backend') {
      if (targetId.value) {
        setBackendAmbienceVolume(targetId.value, soundId, computeVolume(itemVolume) * 100)
          .catch(e => console.warn(`[scene] setAmbienceVolume ${soundId} failed on the backend:`, e))
      }
      return
    }
    const el = ambienceAudioEls.get(soundId)
    if (el)
      el.volume = computeVolume(itemVolume)
  }

  function applyMusicVolume(channel: MusicChannel) {
    if (channel.source === 'backend') {
      if (targetId.value) {
        setBackendMusicVolume(targetId.value, computeVolume(channel.itemVolume) * 100)
          .catch(e => console.warn(`[scene] setMusicVolume ${channel.soundId} failed on the backend:`, e))
      }
    }
    else {
      channel.el.volume = computeVolume(channel.itemVolume)
    }
  }

  /** An Ambience item's volume slider in the open Scene: applies to the sound if it is audible, and sticks for later master volume changes. */
  function updateAmbienceVolume(item: SceneItem) {
    const itemVolume = item.volume ?? 80
    if (playingAmbienceIds.value.has(item.soundId) || startingAmbience.has(item.soundId))
      ambienceItemVolumes.set(item.soundId, itemVolume)
    applyAmbienceVolume(item.soundId, itemVolume)
  }

  /** A Music item's volume slider in the open Scene: applies to the primary track if it is that item, and sticks for later master volume changes. */
  function updateMusicVolume(item: SceneItem) {
    if (primaryMusicChannel.soundId !== item.soundId)
      return
    primaryMusicChannel.itemVolume = item.volume ?? 80
    applyMusicVolume(primaryMusicChannel)
  }

  // Rescales everything audible from the item volumes it was started with, so
  // the master reaches the Playing Scene from any route (#648). Ambience on its
  // way out of a Scene Crossfade is left to its fade.
  function updateAllVolumes() {
    let ambience = 0
    for (const soundId of playingAmbienceIds.value) {
      if (crossfadeRamp.directionOf(ambienceFadeKey(soundId)) === 'out')
        continue
      const itemVolume = ambienceItemVolumes.get(soundId)
      if (itemVolume === undefined) {
        logDebug(`[scene] master volume: no item volume known for Ambience ${soundId}, left as is`)
        continue
      }
      applyAmbienceVolume(soundId, itemVolume)
      ambience++
    }
    if (primaryMusicChannel.soundId !== null)
      applyMusicVolume(primaryMusicChannel)
    logDebug(`[scene] master volume ${masterVolume.value}% applied to ${ambience} Ambience sound(s)${primaryMusicChannel.soundId === null
      ? ''
      : ` and Music ${primaryMusicChannel.soundId}`}`)
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

  /**
   * Moves the active Target's master volume by `delta`, clamped to 0-100, and persists it. Re-reads the stored
   * value first so a press from outside the Scene view cannot step from a stale ref. Resolves to the new volume,
   * or null when already at the bound (nothing changed).
   */
  async function stepMasterVolume(delta: number): Promise<number | null> {
    await loadGlobalVolume()
    const next = Math.min(100, Math.max(0, masterVolume.value + delta))
    if (next === masterVolume.value)
      return null
    masterVolume.value = next
    await updateMasterVolume(targetId.value, next)
    return next
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
        ambienceItemVolumes.delete(soundId)
      }
    }
  })

  function toggleAmbience(item: SceneItem) {
    if (item.enabled && canPlay.value && targetId.value)
      playAmbience(item)
    else
      stopAmbience(item.soundId)
  }

  function claimAmbienceIntent(soundId: string, stopped: boolean): number {
    const token = ++ambienceIntentSeq
    ambienceIntents.set(soundId, { token, stopped })
    return token
  }

  function isAmbienceStartCurrent(soundId: string, token: number): boolean {
    return ambienceIntents.get(soundId)?.token === token
  }

  function sendBackendAmbienceStop(soundId: string, fadeOutMs = 0) {
    if (!targetId.value)
      return
    pendingBackendAmbienceCalls.add(soundId)
    stopBackendAmbience(targetId.value, soundId, fadeOutMs > 0
      ? { fadeOutMs }
      : {})
      .catch(e => console.warn(`[scene] stopAmbience ${soundId} failed on the backend:`, e))
      .finally(() => pendingBackendAmbienceCalls.delete(soundId))
  }

  function stopAmbience(soundId: string, fadeOutMs = 0) {
    claimAmbienceIntent(soundId, true)
    startingAmbience.delete(soundId)
    ambienceItemVolumes.delete(soundId)
    releaseAmbience(soundId, fadeOutMs)
  }

  // Tears down whatever of `soundId` is audible, without overtaking a start in
  // flight — playAmbience's own clean-up before it starts the sound again.
  function releaseAmbience(soundId: string, fadeOutMs = 0) {
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
      sendBackendAmbienceStop(soundId, fadeOutMs)
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
  async function playAmbienceBackend(item: SceneItem, fadeInMs: number, token: number) {
    if (!targetId.value)
      return
    // A sound's backend-decodability is immutable, so a renderer-sourced entry
    // for the same id can only be a leftover; stop it first or it would keep
    // playing, orphaned.
    const previousSource = ambienceSource.get(item.soundId)
    if (previousSource === 'renderer')
      releaseAmbience(item.soundId)
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
      if (!isAmbienceStartCurrent(item.soundId, token)) {
        // The Stop that overtook this start may have reached the backend
        // before the play took hold there; stop again unless a newer play
        // owns the sound by now.
        const stopped = ambienceIntents.get(item.soundId)?.stopped ?? false
        logInfo(`[scene] playAmbience ${item.soundId} superseded during start-up${stopped
          ? ', stopping it again on the backend'
          : ''}`)
        if (stopped)
          sendBackendAmbienceStop(item.soundId)
      }
    }
    catch (e) {
      if (!isAmbienceStartCurrent(item.soundId, token)) {
        logInfo(`[scene] playAmbience ${item.soundId} superseded during start-up (its backend play failed: ${e})`)
        return
      }
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
        ambienceItemVolumes.delete(item.soundId)
      }
    }
    finally {
      pendingBackendAmbienceCalls.delete(item.soundId)
    }
  }

  async function playAmbience(item: SceneItem, initialVolume?: number, fadeInMs = 0) {
    if (!targetId.value || !canPlay.value) {
      logCannotPlay('playAmbience', item.soundId)
      return
    }
    const token = claimAmbienceIntent(item.soundId, false)
    startingAmbience.add(item.soundId)
    ambienceItemVolumes.set(item.soundId, item.volume ?? 80)
    try {
      await startAmbience(item, token, initialVolume, fadeInMs)
    }
    finally {
      if (isAmbienceStartCurrent(item.soundId, token))
        startingAmbience.delete(item.soundId)
    }
  }

  async function startAmbience(item: SceneItem, token: number, initialVolume: number | undefined, fadeInMs: number) {
    const abortIfSuperseded = (failure?: unknown) => {
      if (isAmbienceStartCurrent(item.soundId, token))
        return false
      logInfo(`[scene] playAmbience ${item.soundId} superseded during start-up${failure === undefined
        ? ''
        : ` (then failed: ${failure})`}`)
      return true
    }
    const path = selectBackendPlaybackPath(await canDecodeAmbienceCached(item.soundId))
    if (abortIfSuperseded())
      return
    if (path === 'backend') {
      // Its own try/catch never rethrows (see above) — unlike the renderer
      // path below, a failure here must never reach the generic catch's
      // stopAmbience() call, which could stop a different, still-good
      // backend sound this call was merely trying to replace.
      await playAmbienceBackend(item, fadeInMs, token)
      return
    }
    // Renderer fallback: captured and streamed to a Discord Target, or the
    // output itself under the Local Target (ADR-0004).
    const streamed = !player.isLocalActive
    const target = targetId.value
    // Bailing out never touches the element: the Stop that overtook this
    // start already tore it down, and a newer start owns it from then on.
    try {
      releaseAmbience(item.soundId)
      const el = getAmbienceAudio(item.soundId)
      const streamId = `ambience-${item.soundId}`
      logInfo(`[scene] playAmbience ${item.soundId} via renderer fallback (${streamed ? 'streamed to Discord' : 'local'})`)
      // The element already plays at the final volume and is captured after
      // it, so the mixer input must pass the PCM through unscaled (#711).
      if (streamed)
        await startEffectStream(target, streamId, 100)
      if (abortIfSuperseded())
        return
      el.src = soundStreamUrl('ambience', item.soundId)
      el.loop = isLooping(item)
      el.volume = initialVolume ?? computeVolume(item.volume ?? 80)
      el.load()
      await waitForPlayable(el, `ambience ${item.soundId} (renderer fallback)`)
      if (abortIfSuperseded())
        return
      if (streamed) {
        const onChunk = (chunk: ArrayBuffer) => sendEffectChunk(target, chunk, streamId)
        const sess = await captureFromAudioElement(el, onChunk)
        if (abortIfSuperseded()) {
          sess.stop()
          return
        }
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
      if (abortIfSuperseded())
        return
      playingAmbienceIds.value.add(item.soundId)
      ambienceSource.set(item.soundId, 'renderer')
    }
    catch (e) {
      if (abortIfSuperseded(e))
        return
      console.error('[scene] playAmbience failed:', e)
      stopAmbience(item.soundId)
    }
  }

  // A play call on a Discord Target with no joined channel (or no guild) does
  // nothing; hotkeys and Scene restarts reach it past the disabled buttons,
  // and this line is what makes that diagnosable (#713).
  function logCannotPlay(action: 'playAmbience' | 'playMusic' | 'playEffect', soundId: string) {
    logInfo(`[scene] ${action} ${soundId} ignored: Target ${targetId.value ?? 'none'} cannot play`)
  }

  function clearMusicChannel(channel: MusicChannel) {
    channel.soundId = null
    channel.source = null
    channel.startedAt = null
    channel.durationMs = null
    if (primaryMusicChannel === channel)
      playingMusicId.value = null
    syncMusicClock()
  }

  // Claims `channel` for a start of `item`: its clock waits for the start to be confirmed.
  function claimMusicChannel(channel: MusicChannel, item: SceneItem, source: 'renderer' | 'backend'): number {
    const token = ++musicStartSeq
    channel.soundId = item.soundId
    channel.source = source
    channel.token = token
    channel.backendTarget = null
    channel.itemVolume = item.volume ?? 80
    channel.startedAt = null
    channel.durationMs = null
    channel.loop = item.loop ?? false
    if (channel === primaryMusicChannel)
      playingMusicId.value = item.soundId
    syncMusicClock()
    return token
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
      if (targetId.value) {
        stopBackendMusic(targetId.value, fadeOutMs > 0
          ? { fadeOutMs }
          : {}).catch(() => {})
      }
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
  async function playMusicBackend(item: SceneItem, channel: MusicChannel, fadeInMs: number, durationMs: number | null) {
    if (!targetId.value)
      return
    if (channel.source && channel.source !== 'backend')
      stopMusicChannel(channel, channel.source)
    const target = targetId.value
    const token = claimMusicChannel(channel, item, 'backend')
    await playBackendMusic(target, item.soundId, {
      volume: computeVolume(item.volume ?? 80) * 100,
      loop: item.loop ?? false,
      fadeInMs,
    })
    // The backend has made this its current track before answering, so from
    // here on its disappearance from the state push means it played out.
    if (channel.token !== token)
      return
    // Cleared meanwhile (a Stop, or a newer crossfade that took this track
    // over as its outgoing one): no clock for a track no longer on the channel.
    if (channel.soundId === null) {
      logInfo(`[scene] Music ${item.soundId} confirmed on ${channel.streamId} (token ${token}) after the channel was cleared, no clock`)
      return
    }
    channel.backendTarget = target
    startMusicClock(channel, durationMs)
  }

  async function playMusic(item: SceneItem, channel: MusicChannel = primaryMusicChannel, initialVolume?: number, fadeInMs?: number) {
    if (!targetId.value || !canPlay.value) {
      logCannotPlay('playMusic', item.soundId)
      return
    }
    // Set once the renderer fallback claims the channel: a failed start must
    // then end its stream and capture session too, not just the bookkeeping.
    let rendererToken: number | null = null
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
        await playMusicBackend(item, channel, fadeInMs ?? 0, track.durationMs ?? null)
        return
      }

      // Renderer fallback: captured and streamed to a Discord Target, or the
      // output itself under the Local Target (ADR-0004).
      const streamed = !player.isLocalActive
      const target = targetId.value
      if (channel.source)
        stopMusicChannel(channel, channel.source)
      const token = claimMusicChannel(channel, item, 'renderer')
      rendererToken = token
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
      el.onended = () => onMusicPlayedOut(channel, token)
      // Released like any other Music teardown, so a Discord Target's stream
      // and capture session end with it rather than outliving the track.
      el.onerror = () => {
        if (channel.token !== token) {
          logDebug(`[scene] stale error from music ${item.soundId} ignored, ${channel.streamId} moved on (token ${token} -> ${channel.token})`)
          return
        }
        console.warn(`[scene] music ${item.soundId} errored mid-play, channel ${channel.streamId} released`)
        stopMusicChannel(channel, 'renderer')
      }
      await el.play()
      // With no stored duration (its header could not be read), the element knows it once playable.
      if (channel.token === token) {
        startMusicClock(channel, track.durationMs ?? (Number.isFinite(el.duration) && el.duration > 0
          ? Math.round(el.duration * 1000)
          : null))
      }
    }
    catch (e) {
      console.error('[scene] playMusic failed:', e)
      if (rendererToken !== null && channel.token === rendererToken)
        stopMusicChannel(channel, 'renderer')
      else
        clearMusicChannel(channel)
    }
  }

  // Ends the Music Mode for whatever is playing: a Stop, a new start or a
  // Target switch, never a played-out track, so nothing advances afterwards.
  function releaseMusicMode(reason: string) {
    musicIntent++
    if (musicCursor)
      logDebug(`[scene] Music ${reason}: track ${musicCursor.current} of Scene ${musicCursor.sceneId} ends without an advance`)
    musicCursor = null
    musicSceneId.value = null
  }

  function stopMusic() {
    releaseMusicMode('stopped')
    for (const channel of musicChannels) {
      if (channel.source)
        stopMusicChannel(channel, channel.source)
    }
  }

  // The inline per-track Stop button in the Music section: stops whichever
  // track the primary channel is actually playing.
  function stopMusicPlayback() {
    releaseMusicMode('stopped')
    if (primaryMusicChannel.source)
      stopMusicChannel(primaryMusicChannel, primaryMusicChannel.source)
  }

  async function sceneFadeMs(): Promise<number> {
    return (await fetchSceneFadeLength().catch(() => DEFAULT_CROSSFADE_FALLBACK_SECONDS)) * 1000
  }

  // Outside single, the per-track Loop toggle is ignored (its stored value stays).
  function trackForMode(item: SceneItem, mode: MusicMode): SceneItem {
    return mode === 'single'
      ? item
      : { ...item, loop: false }
  }

  // A plain start on the primary channel (Play, a track's Play with nothing of
  // its Scene playing); resolves whether the track actually started.
  async function startMusicDirect(item: SceneItem): Promise<boolean> {
    await playMusic(item)
    return primaryMusicChannel.soundId === item.soundId
  }

  /**
   * Starts `pick` from `scene`'s Music via `start`, and in sequential/shuffle
   * skips any track that cannot start to the next one the mode picks, giving
   * up silently after a full pass. Abandons the chain once `intent` is stale.
   */
  async function startMusicFrom(
    scene: Scene,
    mode: MusicMode,
    pick: SelectedTrack,
    start: (item: SceneItem) => Promise<boolean>,
    intent: number,
  ): Promise<void> {
    let next: typeof pick | null = pick
    for (let attempts = 0; next && attempts < Math.max(1, scene.music.length); attempts++) {
      if (intent !== musicIntent)
        return
      const item = scene.music[next.index] ?? scene.music.find(m => m.soundId === next!.soundId)
      if (!item) {
        console.warn(`[scene] Music Mode ${mode}: track ${next.soundId} is no longer in Scene ${scene.id}, Music stops`)
        return
      }
      // `start` claims the channel only after this cached probe resolves, so
      // await it here: a Stop landing meanwhile is seen before anything starts.
      await canDecodeMusicCached(item.soundId)
      if (intent !== musicIntent) {
        logInfo(`[scene] Music start of track ${item.soundId} of Scene ${scene.id} superseded, nothing starts`)
        return
      }
      musicCursor = {
        sceneId: scene.id,
        current: next.soundId,
        index: next.index,
        bag: next.bag,
        pass: next.pass,
      }
      musicSceneId.value = scene.id
      if (await start(trackForMode(item, mode)))
        return
      if (intent !== musicIntent || mode === 'single')
        return
      console.warn(`[scene] Music Mode ${mode}: skipping track ${next.soundId} of Scene ${scene.id}, it could not start`)
      next = selectNextTrack({
        mode,
        list: scene.music.map(m => m.soundId),
        current: next.soundId,
        currentIndex: next.index,
        bag: next.bag,
        pass: next.pass,
      })
    }
    if (intent !== musicIntent || mode === 'single')
      return
    console.warn(`[scene] Music Mode ${mode}: no track of Scene ${scene.id} could start, Music goes silent`)
    musicCursor = null
    musicSceneId.value = null
  }

  // The Scene a Music Mode advance reads: the open Scene's live copy (edits
  // land there before they are saved), else the stored one.
  async function liveScene(sceneId: string): Promise<Scene | null> {
    if (openScene.value?.id === sceneId)
      return openScene.value
    return getScene(sceneId)
  }

  // The current Music track played out (not stopped, not replaced): in
  // sequential/shuffle, start the next track from the source Scene's live list,
  // fading in over the Scene fade length.
  function onMusicPlayedOut(channel: MusicChannel, token: number) {
    if (channel !== primaryMusicChannel || channel.token !== token || channel.soundId === null) {
      logDebug(`[scene] Music end on ${channel.streamId} suppressed: that track was already stopped or replaced`)
      return
    }
    const outgoing = channel.soundId
    clearMusicChannel(channel)
    advanceMusic(outgoing).catch(e => console.error('[scene] Music Mode advance failed:', e))
  }

  async function advanceMusic(outgoing: string) {
    const cursor = musicCursor
    if (!cursor || cursor.current !== outgoing) {
      logDebug(`[scene] Music ${outgoing} played out with no Music Mode cursor for it, no advance`)
      return
    }
    const intent = musicIntent
    const scene = await liveScene(cursor.sceneId).catch((e) => {
      console.warn(`[scene] Music Mode: could not load Scene ${cursor.sceneId} to advance after ${outgoing}:`, e)
      return null
    })
    if (intent !== musicIntent || !scene)
      return
    const mode = normalizeMusicMode(scene.musicMode)
    if (mode === 'single')
      return
    const next = selectNextTrack({
      mode,
      list: scene.music.map(m => m.soundId),
      current: cursor.current,
      currentIndex: cursor.index,
      bag: cursor.bag,
      pass: cursor.pass,
    })
    if (!next) {
      logInfo(`[scene] Music Mode ${mode}: Scene ${scene.id} has no Music left after ${outgoing}, Music ends`)
      musicCursor = null
      musicSceneId.value = null
      return
    }
    const fadeMs = await sceneFadeMs()
    if (intent !== musicIntent)
      return
    logInfo(`[scene] Music Mode ${mode} advance in Scene ${scene.id}: ${outgoing} -> ${next.soundId}, fade-in ${fadeMs} ms`)
    await startMusicFrom(scene, mode, next, item => crossfadeMusic(item, fadeMs), intent)
  }

  // Backend-decoded tracks report their end only through the state push: the
  // confirmed-started primary track vanishing from it (on the Target it was
  // started on) means it played out. A Stop clears the channel first, so it
  // never reaches here as an end.
  // A missing or non-live entry (a failed state fetch) says nothing about the
  // track, so it is never read as an end.
  watch(() => {
    const state = player.activeTargetState
    return state?.source === 'live'
      ? (state.track?.id ?? null)
      : undefined
  }, (trackId) => {
    const channel = primaryMusicChannel
    if (trackId === undefined || channel.source !== 'backend' || channel.soundId === null || channel.backendTarget === null)
      return
    if (channel.backendTarget !== targetId.value || trackId === channel.soundId)
      return
    onMusicPlayedOut(channel, channel.token)
  })

  /**
   * A Music track's Play button in the open Scene. While that Scene's Music is
   * playing in sequential/shuffle this is a jump: a crossfade to the track,
   * after which the mode continues from it. Otherwise a plain start, exactly
   * as before Music Modes.
   */
  async function playMusicTrack(item: SceneItem) {
    const scene = openScene.value
    const index = scene
      ? scene.music.findIndex(m => m.soundId === item.soundId)
      : -1
    if (!scene || index < 0) {
      releaseMusicMode('replaced')
      await playMusic(item)
      return
    }
    const mode = normalizeMusicMode(scene.musicMode)
    const isJump = mode !== 'single' && musicSceneId.value === scene.id && primaryMusicChannel.soundId !== null
    const outgoing = primaryMusicChannel.soundId
    releaseMusicMode(isJump ? 'jumped' : 'replaced')
    const intent = musicIntent
    const list = scene.music.map(m => m.soundId)
    const pick: SelectedTrack = {
      soundId: item.soundId,
      index,
      bag: mode === 'shuffle'
        ? shuffleBagWithout(list, item.soundId)
        : [],
      pass: list,
    }
    if (!isJump) {
      await startMusicFrom(scene, mode, pick, startMusicDirect, intent)
      return
    }
    const fadeMs = await sceneFadeMs()
    if (intent !== musicIntent)
      return
    logInfo(`[scene] Music Mode ${mode} jump in Scene ${scene.id}: ${outgoing} -> ${item.soundId}, fade ${fadeMs} ms`)
    await startMusicFrom(scene, mode, pick, track => crossfadeMusic(track, fadeMs), intent)
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
    if (!targetId.value || !canPlay.value) {
      logCannotPlay('playEffect', item.soundId)
      return
    }
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
    // Set once the instance is torn down (a Stop, cap eviction) — a start
    // still loading must then never play.
    let removed = false
    const id = player.registerRendererEffectInstance(item.soundId, () => {
      removed = true
      teardownEffectAudioEl(id, el, streamed)
    })
    const abortIfRemoved = (failure?: unknown) => {
      if (!removed)
        return false
      logInfo(`[scene] playEffect ${item.soundId} (${id}) stopped during start-up${failure === undefined
        ? ''
        : ` (then failed: ${failure})`}`)
      return true
    }
    logInfo(`[scene] playEffect ${item.soundId} via renderer fallback (${streamed ? 'streamed to Discord' : 'local'}) as ${id}`)
    try {
      // Already scaled by the element's volume: unscaled mixer input (#711).
      if (streamed)
        await startEffectStream(target, id, 100)
      if (abortIfRemoved())
        return
      el.src = soundStreamUrl('effects', item.soundId)
      el.volume = (item.volume ?? 80) / 100 * (masterVolume.value / 100)
      el.load()
      await waitForPlayable(el, `effect ${item.soundId} (renderer fallback)`)
      if (abortIfRemoved())
        return
      if (Number.isFinite(el.duration))
        player.setEffectInstanceDuration(id, el.duration * 1000)
      if (streamed) {
        const onChunk = (chunk: ArrayBuffer) => sendEffectChunk(target, chunk, id)
        const sess = await captureFromAudioElement(el, onChunk)
        if (abortIfRemoved()) {
          sess.stop()
          return
        }
        captureSessions.set(id, sess)
      }
      el.onended = () => player.removeRendererEffectInstance(id)
      el.onerror = () => player.removeRendererEffectInstance(id)
      await el.play()
    }
    catch (e) {
      if (abortIfRemoved(e))
        return
      console.error('[scene] playEffect failed:', e)
      player.removeRendererEffectInstance(id)
    }
  }

  // A Scene that should restart on Discord as soon as a channel is joined — set
  // by a Target handover to Discord while no channel is connected.
  const pendingHandoverSceneId = ref<string | null>(null)

  // Usage Stats: one `scene-play` per Scene start, whatever triggered it,
  // except the restart of a Target handover (that is a `target-switch`).
  function trackScenePlay(target: Scene) {
    trackUsage({
      name: 'scene-play',
      data: {
        musicMode: normalizeMusicMode(target.musicMode),
        music: target.music.length,
        ambience: target.ambience.length,
        effects: target.effects.length,
        target: player.activeTarget,
      },
    })
  }

  async function playScene(target: Scene) {
    if (!canPlay.value || !targetId.value)
      return
    trackScenePlay(target)
    await startScene(target)
  }

  async function startScene(target: Scene) {
    if (!canPlay.value || !targetId.value)
      return
    stopScene()
    const scenePlay = ++sceneIntent
    // Captured now, not after the Ambience awaits: Music must not start for a
    // Scene whose start-up a Stop, Play or Crossfade has meanwhile overtaken.
    const intent = musicIntent
    const abortIfSuperseded = () => {
      if (scenePlay === sceneIntent)
        return false
      logInfo(`[scene] play Scene ${target.id} superseded, aborting start-up`)
      return true
    }
    player.setPlayingScene(target.id, targetId.value)
    logInfo(`[scene] play Scene ${target.id} on Target ${targetId.value}`)
    warmSceneEffects(target)
    sceneTransitionFlash.trigger(SCENE_START_FLASH)
    try {
      for (const item of target.ambience.filter(a => a.enabled)) {
        await playAmbience(item)
        if (abortIfSuperseded())
          return
      }
      const mode = normalizeMusicMode(target.musicMode)
      const first = selectFirstTrack(mode, target.music.map(m => m.soundId))
      if (first)
        await startMusicFrom(target, mode, first, startMusicDirect, intent)
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
    sceneIntent++
    pendingHandoverSceneId.value = null
    for (const soundId of new Set([
      ...playingAmbienceIds.value,
      ...startingAmbience,
    ]))
      stopAmbience(soundId)
    stopMusic()
    stopAllEffectInstances()
    player.clearPlayingScene()
  }

  // Hard handover (ADR-0004): stop everything on the old Target, then restart
  // the Playing Scene from the top on the new one — no cross-Target fade.
  async function restartHandoverScene(sceneToRestart: string) {
    try {
      const target = openScene.value?.id === sceneToRestart
        ? openScene.value
        : await getScene(sceneToRestart)
      if (target)
        await startScene(target)
    }
    catch (e) {
      console.error('[scene] Target handover could not restart the Scene:', e)
    }
  }

  async function switchTarget(kind: OutputTargetKind) {
    if (kind === player.activeTarget)
      return
    const playingId = player.playingSceneId
    logInfo(`[scene] switching Output Target ${player.activeTarget} -> ${kind}${playingId
      ? `, restarting Scene ${playingId}`
      : ''}`)
    trackUsage({
      name: 'target-switch',
      data: { target: kind },
    })
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
    // Taken before the fade-outs below drop backend ids from `playingAmbienceIds`
    // (a backend start is listed there from its first await on).
    const stillLoading = [...startingAmbience].filter(id => !playingAmbienceIds.value.has(id))

    for (const soundId of [...playingAmbienceIds.value]) {
      const source = ambienceSource.get(soundId)
      if (!source || targetItems.has(soundId))
        continue
      if (source === 'backend') {
        // GuildAudioManager owns this sound's fade-out and stop (ADR-0003);
        // bookkeeping drops right away so a later switch never reconsiders it.
        if (targetId.value) {
          stopBackendAmbience(targetId.value, soundId, durationMs > 0
            ? { fadeOutMs: durationMs }
            : {}).catch(() => {})
        }
        playingAmbienceIds.value.delete(soundId)
        ambienceSource.delete(soundId)
        ambienceItemVolumes.delete(soundId)
        continue
      }
      // Already on its way out from an earlier switch — let it finish; only a
      // Scene that wants it back (below) turns an outgoing fade around.
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

    // A renderer fallback still loading is only in `startingAmbience`, out of
    // reach of the fades above: stop it outright so its start aborts, like
    // stopScene does, instead of it starting under the new Scene.
    for (const soundId of stillLoading) {
      if (targetItems.has(soundId))
        continue
      logInfo(`[scene] crossfade: stopping ${soundId}, still starting up for the outgoing Scene (Scene ${target.id})`)
      stopAmbience(soundId)
    }

    for (const item of targetItems.values()) {
      const to = computeVolume(item.volume ?? 80)
      const source = ambienceSource.get(item.soundId)
      const alreadyPlaying = playingAmbienceIds.value.has(item.soundId) && !!source
      if (alreadyPlaying) {
        ambienceItemVolumes.set(item.soundId, item.volume ?? 80)
        if (source === 'backend') {
          // The shared-sound rule (CONTEXT.md): never restarted, just glided
          // to the new Scene's volume.
          if (targetId.value) {
            setBackendAmbienceVolume(targetId.value, item.soundId, to * 100, durationMs > 0
              ? { rampMs: durationMs }
              : {}).catch(() => {})
          }
          continue
        }
        const el = ambienceAudioEls.get(item.soundId)
        if (!el)
          continue
        // Still fading out of an earlier switch, whose onDone would stop it:
        // the ramp never turns an 'out' fade around, so drop it and glide back
        // in from wherever it got to.
        const fadeKey = ambienceFadeKey(item.soundId)
        if (crossfadeRamp.directionOf(fadeKey) === 'out') {
          logInfo(`[scene] crossfade: retargeting ${item.soundId} from out to in (Scene ${target.id})`)
          crossfadeRamp.cancel(fadeKey)
        }
        crossfadeRamp.fade(fadeKey, {
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
          if (ambienceSource.get(item.soundId) !== 'renderer')
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
  // Also the switch a Music Mode advance or jump makes within one Scene
  // (ADR-0006). Resolves whether `targetTrack` started (false with none).
  function crossfadeMusic(targetTrack: SceneItem | null, durationMs: number): Promise<boolean> {
    const outgoingChannel = primaryMusicChannel
    const outgoingHadTrack = outgoingChannel.soundId != null
    const outgoingWasBackend = outgoingChannel.source === 'backend'
    // A newer crossfade may re-claim the outgoing channel for its own incoming
    // track before this one's backend play lands; that track is then not ours to clear.
    const outgoingToken = outgoingChannel.token
    const outgoingStillOurs = (action: 'clearing' | 'stopping' | 'restoring') => {
      if (outgoingChannel.token === outgoingToken)
        return true
      logInfo(`[scene] crossfade to ${targetTrack?.soundId}: not ${action} ${outgoingChannel.streamId}, re-claimed meanwhile (token ${outgoingToken} -> ${outgoingChannel.token})`)
      return false
    }
    const incomingChannel = targetTrack
      ? (musicChannels.find(c => c !== outgoingChannel) ?? musicChannels[1])
      : null
    let started: Promise<boolean> = Promise.resolve(false)

    if (incomingChannel) {
      primaryMusicChannel = incomingChannel
      syncMusicClock()
      // The backend path (ADR-0003) drives its own fade-in via fadeInMs.
      started = playMusic(targetTrack!, incomingChannel, 0, durationMs).then(() => {
        // playMusic swallows its own failures internally (console.error +
        // clearMusicChannel) rather than rejecting, so this always runs — a
        // failed start shows up as `incomingChannel` having been cleared back
        // to empty.
        if (incomingChannel.soundId !== targetTrack!.soundId) {
          // If the outgoing track is still alive on the backend (preserved on
          // purpose below), restore it as primary so Stop/volume controls can
          // reach it again instead of leaving it reachable only on the
          // backend with no surviving UI handle. A newer crossfade that
          // re-claimed the outgoing channel owns primary instead.
          if (outgoingHadTrack && outgoingWasBackend && outgoingStillOurs('restoring')) {
            primaryMusicChannel = outgoingChannel
            playingMusicId.value = outgoingChannel.soundId
            syncMusicClock()
          }
          return false
        }
        if (incomingChannel.source === 'backend') {
          // The backend already faded the previous backend track out (and
          // stopped it) as a side effect of this call succeeding, but only
          // when the OUTGOING track was also backend-sourced — see
          // GuildAudioManager.playMusic, which only knows about its own prior
          // backend track. Only drop the renderer's own bookkeeping for it
          // once we know that actually happened.
          if (outgoingHadTrack && outgoingWasBackend && outgoingStillOurs('clearing'))
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
          if (outgoingHadTrack && outgoingWasBackend && outgoingStillOurs('stopping'))
            stopMusicChannel(outgoingChannel, 'backend', durationMs)
        }
        return true
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
    return started
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
    const durationMs = await sceneFadeMs()
    sceneIntent++
    player.setPlayingScene(target.id, targetId.value)
    trackScenePlay(target)
    warmSceneEffects(target)
    sceneTransitionFlash.trigger(SCENE_START_FLASH)
    crossfadeAmbience(target, durationMs)
    releaseMusicMode('crossfaded away')
    const mode = normalizeMusicMode(target.musicMode)
    const first = selectFirstTrack(mode, target.music.map(m => m.soundId))
    if (!first) {
      crossfadeMusic(null, durationMs)
      return
    }
    startMusicFrom(target, mode, first, item => crossfadeMusic(item, durationMs), musicIntent)
      .catch(e => console.error('[scene] crossfadeToScene: Music start failed:', e))
  }

  // Only react to the selected guild's own connection dropping — not to the GM
  // switching the sidebar selection to a different, not-yet-joined guild (which
  // also flips `isJoined` false but shouldn't stop another guild's playback).
  // The Local Target has no voice connection, so it never reacts to this.
  watch([
    () => player.guildId,
    () => player.isJoined,
  ], ([newGuildId, joined], [oldGuildId, wasJoined]) => {
    if (!player.isLocalActive && newGuildId === oldGuildId && wasJoined && !joined)
      stopScene()
  })

  return {
    openScene,
    musicSounds,
    masterVolume,
    playingMusicId,
    musicProgress,
    musicSceneId,
    playingAmbienceIds,
    effectFlash,
    sceneTransitionFlash,
    loadMasterVolume: loadGlobalVolume,
    saveMasterVolume: saveGlobalVolume,
    stepMasterVolume,
    computeVolume,
    updateAmbienceVolume,
    updateMusicVolume,
    toggleAmbience,
    stopAmbience,
    playAmbience,
    playMusic,
    playMusicTrack,
    stopMusicPlayback,
    playEffect,
    playScene,
    stopScene,
    switchTarget,
    crossfadeToScene,
    stopAllEffectInstances,
  }
})
