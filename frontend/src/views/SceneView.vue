<script setup lang="ts">
import type { OutputTargetKind, VisionProviderId } from '@/api/config'
import type { MusicMode, Scene, SceneItem } from '@/api/scenes'
import type { SoundFile } from '@/api/sounds'
import type { EffectSoundStatus } from '@/stores/player'
import type { MusicProgress } from '@/stores/scene-playback'
import { storeToRefs } from 'pinia'
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { fetchVisionConfig, LOCAL_TARGET_ID, openFileDialog, saveFileDialog } from '@/api/config'
import { deleteScene, exportScene, getScene, importScene, listScenes, saveScene } from '@/api/scenes'
import { listAmbience, listEffects, listMusic } from '@/api/sounds'
import { logInfo } from '@/audio/audio-element-diagnostics'
import { normalizeMusicMode } from '@/audio/music-mode'
import HotkeyRecorder from '@/components/HotkeyRecorder.vue'
import RegistryBrowser from '@/components/RegistryBrowser.vue'
import ResolveSoundDialog from '@/components/ResolveSoundDialog.vue'
import VisionToVibeDialog from '@/components/VisionToVibeDialog.vue'
import { usePlayerStore } from '@/stores/player'
import { SCENE_START_FLASH, useScenePlaybackStore } from '@/stores/scene-playback'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const toast = useToastStore()
// Scene orchestration (play/stop, Scene Crossfade, renderer-fallback audio)
// lives in the store so it survives leaving this view; the view renders state
// and calls store actions.
const playback = useScenePlaybackStore()
const { masterVolume: globalVolume, playingMusicId, musicProgress, playingAmbienceIds, musicSounds } = storeToRefs(playback)
const { effectFlash, sceneTransitionFlash } = playback
const { playScene: playSceneFor, stopScene, stopAmbience, playMusicTrack, playEffect, stopMusicPlayback, stopAllEffectInstances, updateAmbienceVolume, updateMusicVolume } = playback

const scenes = ref<Scene[]>([])
const scene = ref<Scene | null>(null)
const ambienceSounds = ref<SoundFile[]>([])
const effectsSounds = ref<SoundFile[]>([])
const showCreateInput = ref(false)
const newSceneName = ref('')
const createSceneBusy = ref(false)
const exportBusy = ref(false)
const importBusy = ref(false)
const showRegistryBrowser = ref(false)
const visionAvailable = ref(false)
const visionProvider = ref<VisionProviderId>('claude')
const visionEndpoint = ref('')
const showVisionDialog = ref(false)
const resolveTarget = ref<{ category: 'ambience' | 'music' | 'effects', item: SceneItem } | null>(null)
// One per load so a later success only clears its own failure.
const scenesLoadError = ref<string | null>(null)
const sceneLoadError = ref<string | null>(null)
const soundsLoadError = ref<string | null>(null)
const exportImportMessage = ref<{ type: 'success' | 'error', text: string } | null>(null)

// The store reads the open Scene's live copy for Music Mode advances, Target
// handovers and Music track jumps, so it needs to follow this view's Scene.
watch(scene, (s) => {
  playback.openScene = s
}, { immediate: true, flush: 'sync' })

const MUSIC_MODE_OPTIONS: { value: MusicMode, label: string, title: string }[] = [
  { value: 'single', label: 'Single', title: 'Play one track; its Loop toggle repeats it' },
  { value: 'sequential', label: 'Sequential', title: 'Play the tracks in order, starting over after the last' },
  { value: 'shuffle', label: 'Shuffle', title: 'Play every track once in random order, then reshuffle' },
]

const musicMode = computed(() => normalizeMusicMode(scene.value?.musicMode))

function setMusicMode(mode: MusicMode) {
  if (!scene.value || musicMode.value === mode)
    return
  logInfo(`[scenes] Music Mode ${musicMode.value} -> ${mode} in scene ${scene.value.id}`)
  scene.value.musicMode = mode
  persistScene(`Music Mode ${mode}`)
}

// The Scene as last persisted: an edit whose save fails rolls back to it, so
// the editor never shows a change that is not on disk.
let persistedScene: Scene | null = null
let saveSeq = 0
let persistedSeq = 0

function cloneScene(s: Scene): Scene {
  return JSON.parse(JSON.stringify(s))
}

function rememberPersisted(s: Scene | null) {
  persistedScene = s && cloneScene(s)
  persistedSeq = saveSeq
}

/** Records a save that reached disk; saves can only move the baseline forward. */
function markPersisted(seq: number, sent: Scene) {
  if (seq > persistedSeq && persistedScene?.id === sent.id) {
    persistedScene = sent
    persistedSeq = seq
  }
}

// A rollback can undo several unsaved edits at once, so bring every audible
// Ambience toggle and item volume of the open Scene back in line with it. An
// item missing on one side (an undone removal, add or relink) counts as off.
function resyncAudioAfterRollback(undone: Scene, restored: Scene) {
  for (const item of undone.ambience) {
    if (item.enabled && !restored.ambience.some(i => i.soundId === item.soundId))
      stopAmbience(item.soundId)
  }
  for (const item of restored.ambience) {
    const before = undone.ambience.find(i => i.soundId === item.soundId)
    if (Boolean(before?.enabled) !== Boolean(item.enabled))
      playback.toggleAmbience(item)
    updateAmbienceVolume(item)
  }
  for (const item of restored.music)
    updateMusicVolume(item)
}

// Every in-place edit of the open Scene saves through here. A failure is
// logged, toasted and, when no later save is in flight, rolled back to the
// last persisted Scene (a later save carries this edit too, so its own outcome
// decides).
async function persistScene(what: string) {
  const current = scene.value
  if (!current)
    return
  const seq = ++saveSeq
  const sent = cloneScene(current)
  try {
    await saveScene(current)
    markPersisted(seq, sent)
    logInfo(`[scenes] Saved ${what} in scene ${sent.id}`)
  }
  catch (err) {
    const rollBack = seq === saveSeq && scene.value?.id === sent.id && persistedScene?.id === sent.id
    console.warn(`[scenes] save failed (${what}) for scene ${sent.id}${rollBack
      ? ', rolled back'
      : ''}:`, err)
    toast.show({ type: 'error', text: `Couldn't save ${what}. ${rollBack
      ? 'The change was undone.'
      : 'Try again.'}` })
    if (rollBack && persistedScene && scene.value) {
      const undone = scene.value
      scene.value = cloneScene(persistedScene)
      resyncAudioAfterRollback(undone, scene.value)
    }
  }
}

const INTERVAL_OPTIONS = [
  0,
  5,
  10,
  15,
  20,
  30,
  45,
  60,
  90,
  120,
  180,
  300,
  600,
]

function formatInterval(seconds: number): string {
  if (seconds === 0)
    return '0s'
  if (seconds < 60)
    return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0
    ? `${m}m ${s}s`
    : `${m}m`
}

/** `m:ss` for an elapsed/total timer label (whole seconds, per #509's acceptance criteria). */
function formatTimerSeconds(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Elapsed / total of an Effect's longest-remaining instance (#509) or the playing Music track (#695). */
type TimerProgress = Pick<EffectSoundStatus, 'elapsedMs' | 'totalMs'>

/** `m:ss / m:ss` (elapsed / total). */
function timerLabel(progress: TimerProgress): string {
  return `${formatTimerSeconds(progress.elapsedMs)} / ${formatTimerSeconds(progress.totalMs)}`
}

/** 0-100 fill percentage, or 0 while the duration isn't known yet. */
function progressPercent(progress: TimerProgress): number {
  if (progress.totalMs <= 0)
    return 0
  return Math.min(100, (progress.elapsedMs / progress.totalMs) * 100)
}

/** The playing Music track's progress when `soundId` is that track, else null. */
function musicProgressFor(soundId: string): MusicProgress | null {
  return musicProgress.value?.soundId === soundId
    ? musicProgress.value
    : null
}

// One `player.effectStatus()` scan per Effect item per reactive tick, shared by the whole card.
const effectCards = computed(() => {
  if (!scene.value)
    return []
  return scene.value.effects.map(item => ({
    item,
    status: player.effectStatus(item.soundId),
  }))
})

// Hotkey bindings are validated when the Scene is saved (uniqueness, Stop Hotkey), so a rejection
// surfaces here: revert the edit and show the message on the recorder that caused it.
const hotkeyErrors = ref<Record<string, string>>({})
watch(() => scene.value?.id, () => {
  hotkeyErrors.value = {}
})

async function bindHotkey(errorKey: string, target: { hotkey?: string }, value: string | undefined) {
  if (!scene.value)
    return
  const previous = target.hotkey
  logInfo(`[scenes] ${value
    ? `Binding hotkey ${value}`
    : 'Clearing hotkey'} on ${errorKey} in scene ${scene.value.id}`)
  if (value)
    target.hotkey = value
  else
    delete target.hotkey
  const { [errorKey]: _cleared, ...rest } = hotkeyErrors.value
  hotkeyErrors.value = rest
  const seq = ++saveSeq
  const sent = cloneScene(scene.value)
  try {
    await saveScene(scene.value)
    markPersisted(seq, sent)
    // The Scene list shows the Scene Hotkey chip, so refresh it from the store.
    await loadScenes()
  }
  catch (e) {
    if (previous)
      target.hotkey = previous
    else
      delete target.hotkey
    console.warn(`[scenes] Hotkey ${value ?? '(cleared)'} rejected for ${errorKey} in scene ${scene.value.id}:`, e)
    hotkeyErrors.value = {
      ...hotkeyErrors.value,
      [errorKey]: e instanceof Error
        ? e.message
        : 'Couldn\'t bind that hotkey.',
    }
  }
}

function updateRepeat(item: SceneItem, field: 'repeatMin' | 'repeatMax', value: number) {
  item[field] = value
  if (field === 'repeatMin' && (item.repeatMax ?? 0) < value)
    item.repeatMax = value
  if (field === 'repeatMax' && value < (item.repeatMin ?? 0))
    item.repeatMin = value
  persistScene(`the repeat interval of ${item.soundName ?? item.soundId}`)
}

const sceneId = computed(() => {
  if (route.path === '/scenes' || route.path.startsWith('/scenes/'))
    return route.params.id as string
  return undefined
})

const canPlay = computed(() => player.canPlay)

const hasSounds = computed(() =>
  ambienceSounds.value.length > 0 || musicSounds.value.length > 0 || effectsSounds.value.length > 0,
)

const hasAnySoundMissing = computed(() => {
  if (!scene.value)
    return false
  return [
    ...scene.value.ambience,
    ...scene.value.music,
    ...scene.value.effects,
  ]
    .some(item => isSoundMissing(
      scene.value!.ambience.includes(item)
        ? 'ambience'
        : scene.value!.music.includes(item)
          ? 'music'
          : 'effects',
      item.soundId,
    ))
})

const isScenePlayingHere = computed(() =>
  scene.value != null && player.playingSceneId === scene.value.id,
)

// Gated on the scene-level playing flag (not just "is a track currently
// audible") so this never contradicts the Play/Stop button next to it — a
// track can end naturally (onended clears playingMusicId) while the scene is
// still "started" and Stop is still the right action.
const nowPlayingLabel = computed(() => {
  if (!isScenePlayingHere.value)
    return 'Nothing playing'
  const parts: string[] = []
  // Backend-decoded Music (ADR-0003) is reported by GuildAudioManager and
  // survives a renderer reload, so it's preferred over the local ref here —
  // see CONTEXT.md on "now playing" sourcing.
  const backendTrack = player.activeTargetState?.track
  if (backendTrack && backendTrack.category === 'music') {
    parts.push(backendTrack.name)
  }
  else if (playingMusicId.value) {
    const musicItem = scene.value?.music.find(m => m.soundId === playingMusicId.value)
    parts.push(musicItem?.soundName ?? resolveSoundName('music', playingMusicId.value))
  }
  if (playingAmbienceIds.value.size > 0)
    parts.push(`${playingAmbienceIds.value.size} ambience`)
  return parts.length > 0
    ? parts.join(' · ')
    : 'Scene playing'
})

function sceneSoundCount(s: Scene): number {
  return s.ambience.length + s.music.length + s.effects.length
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  if (d.getFullYear() === now.getFullYear())
    return `${months[d.getMonth()]} ${d.getDate()}`
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

function resolveSoundName(category: 'ambience' | 'music' | 'effects', soundId: string): string {
  const list = category === 'ambience'
    ? ambienceSounds.value
    : category === 'music'
      ? musicSounds.value
      : effectsSounds.value
  return list.find(s => s.id === soundId)?.name ?? soundId
}

const loadGlobalVolume = () => playback.loadMasterVolume()
const saveGlobalVolume = () => playback.saveMasterVolume()

async function loadScenes() {
  try {
    scenes.value = await listScenes()
    scenesLoadError.value = null
  }
  catch (err) {
    console.warn('[scenes] load failed: Scene list:', err)
    scenesLoadError.value = err instanceof Error
      ? err.message
      : 'Couldn\'t load scenes. Try again.'
  }
}

async function loadScene() {
  sceneLoadError.value = null
  if (sceneId.value === undefined || !sceneId.value) {
    scene.value = null
    rememberPersisted(null)
    return
  }
  const id = sceneId.value
  try {
    const loaded = await getScene(id)
    scene.value = loaded
    rememberPersisted(loaded)
    if (!loaded) {
      console.warn(`[scenes] load failed: scene ${id} not found`)
      sceneLoadError.value = 'This scene no longer exists.'
    }
  }
  catch (err) {
    console.warn(`[scenes] load failed: scene ${id}:`, err)
    sceneLoadError.value = err instanceof Error
      ? err.message
      : 'Couldn\'t load this scene. Try again.'
  }
}

async function loadVisionAvailability() {
  try {
    const config = await fetchVisionConfig()
    visionAvailable.value = config.enabled && config.configured
    visionProvider.value = config.provider
    visionEndpoint.value = config.openaiCompatible.baseUrl
  }
  catch {
    visionAvailable.value = false
  }
}

async function loadSounds() {
  try {
    const [ambience, music, effects] = await Promise.all([
      listAmbience(),
      listMusic(),
      listEffects(),
    ])
    ambienceSounds.value = ambience
    musicSounds.value = music
    effectsSounds.value = effects
    soundsLoadError.value = null
  }
  catch (err) {
    console.warn('[scenes] load failed: sound library:', err)
    soundsLoadError.value = err instanceof Error
      ? err.message
      : 'Couldn\'t load sounds. Try again.'
  }
}

function toggleAmbience(item: SceneItem) {
  persistScene(`${item.soundName ?? item.soundId} ${item.enabled
    ? 'on'
    : 'off'}`)
  playback.toggleAmbience(item)
}

async function addToScene(category: 'ambience' | 'music' | 'effects', sound: SoundFile) {
  if (!scene.value)
    return
  const list = scene.value[category]
  if (list.some((i: SceneItem) => i.soundId === sound.id))
    return
  list.push({
    soundId: sound.id,
    soundName: sound.name,
    volume: 80,
    enabled: category === 'ambience',
    loop: category === 'music',
  })
  await persistScene(`${sound.name} to the scene`)
}

async function removeFromScene(category: 'ambience' | 'music' | 'effects', soundId: string) {
  if (!scene.value)
    return
  const list = scene.value[category]
  const idx = list.findIndex((i: SceneItem) => i.soundId === soundId)
  if (idx >= 0) {
    const [removed] = list.splice(idx, 1)
    // The per-track Stop lives on the removed card, so stop what it was playing.
    if (category === 'ambience') {
      stopAmbience(soundId)
    }
    else if (category === 'music') {
      if (playingMusicId.value === soundId) {
        logInfo(`[scenes] Removed playing Music track ${soundId} from scene ${scene.value.id}, stopping it`)
        stopMusicPlayback()
      }
    }
    else {
      player.stopEffectSound(soundId)
        .catch(e => console.warn(`[scenes] Stopping removed Effect ${soundId} failed:`, e))
    }
    await persistScene(`the removal of ${removed.soundName ?? soundId}`)
  }
}

function playScene() {
  if (scene.value)
    return playSceneFor(scene.value)
}

function stopPlayingScene() {
  stopScene()
}

function switchTarget(kind: OutputTargetKind) {
  return playback.switchTarget(kind)
}

function openCreateScene() {
  showCreateInput.value = true
  newSceneName.value = ''
}

function cancelCreateScene() {
  showCreateInput.value = false
  newSceneName.value = ''
}

async function submitCreateScene() {
  const name = newSceneName.value.trim()
  if (!name || createSceneBusy.value)
    return
  createSceneBusy.value = true
  exportImportMessage.value = null
  try {
    const newScene = await saveScene({
      name,
      ambience: [],
      music: [],
      effects: [],
    })
    scenes.value = await listScenes()
    showCreateInput.value = false
    newSceneName.value = ''
    await router.push(`/scenes/${newScene.id}`)
  }
  catch (err) {
    exportImportMessage.value = {
      type: 'error',
      text: err instanceof Error
        ? err.message
        : 'Couldn\'t create the scene. Try again.',
    }
  }
  finally {
    createSceneBusy.value = false
  }
}

async function deleteCurrentScene() {
  // eslint-disable-next-line no-alert -- simple confirm for destructive action
  if (!scene.value || !confirm(`Delete "${scene.value.name}"? This can't be undone.`))
    return
  const { id, name } = scene.value
  logInfo(`[scenes] Deleting scene ${id}`)
  try {
    await deleteScene(id)
  }
  catch (err) {
    console.warn(`[scenes] delete failed for scene ${id}:`, err)
    toast.show({ type: 'error', text: `Couldn't delete "${name}". Try again.` })
    return
  }
  // Only once it is gone: stops the Playing Scene if this is it, and any
  // ambience/music started individually on this open Scene either way.
  stopScene()
  await loadScenes()
  await router.push('/scenes')
  scene.value = null
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\?*:|<>"]/g, '-').trim() || 'scene'
}

async function doExportScene() {
  if (!scene.value)
    return
  exportImportMessage.value = null
  const targetPath = await saveFileDialog({
    title: 'Export scene as zip',
    defaultPath: `${sanitizeFileName(scene.value.name)}.zip`,
    filters: [
      {
        name: 'Zip Archives',
        extensions: ['zip'],
      },
    ],
  })
  if (!targetPath)
    return
  exportBusy.value = true
  try {
    await exportScene(scene.value.id, targetPath)
    exportImportMessage.value = { type: 'success', text: `Exported to ${targetPath}` }
  }
  catch (e) {
    exportImportMessage.value = {
      type: 'error',
      text: e instanceof Error
        ? e.message
        : 'Export failed. Check that the folder is writable and try again.',
    }
  }
  finally {
    exportBusy.value = false
  }
}

async function doImportScene() {
  exportImportMessage.value = null
  const sourcePath = await openFileDialog({
    title: 'Import scene from zip',
    filters: [
      {
        name: 'Zip Archives',
        extensions: ['zip'],
      },
    ],
  })
  if (!sourcePath)
    return
  importBusy.value = true
  try {
    const imported = await importScene(sourcePath)
    const [sceneList] = await Promise.all([
      listScenes(),
      loadSounds(),
    ])
    scenes.value = sceneList
    await router.push(`/scenes/${imported.id}`)
    exportImportMessage.value = { type: 'success', text: `Imported "${imported.name}"` }
  }
  catch (e) {
    exportImportMessage.value = {
      type: 'error',
      text: e instanceof Error
        ? e.message
        : 'Import failed. Make sure the file is a valid Hibiki scene (.zip) and try again.',
    }
  }
  finally {
    importBusy.value = false
  }
}

function isSoundMissing(category: 'ambience' | 'music' | 'effects', soundId: string): boolean {
  const list = category === 'ambience'
    ? ambienceSounds.value
    : category === 'music'
      ? musicSounds.value
      : effectsSounds.value
  return !list.some(s => s.id === soundId)
}

async function relinkSound(category: 'ambience' | 'music' | 'effects', item: SceneItem, soundId: string, soundName: string) {
  if (!scene.value)
    return
  const previous = item.soundName ?? item.soundId
  item.soundId = soundId
  item.soundName = soundName
  await Promise.all([
    persistScene(`the relink of ${previous} to ${soundName}`),
    loadSounds(),
  ])
}

async function onRegistryInstalled(sceneId: string) {
  scenes.value = await listScenes()
  showRegistryBrowser.value = false
  await router.push(`/scenes/${sceneId}`)
}

onMounted(async () => {
  loadScenes()
  loadSounds()
  loadVisionAvailability()
  await player.loadActiveTarget()
  loadGlobalVolume()
})

onActivated(() => {
  loadScenes()
  loadSounds()
  loadScene()
  loadVisionAvailability()
})

// Going to the Scene list, or re-opening the Scene that's already playing,
// must not stop it — only opening a *different* Scene stops the Playing
// Scene. But ambience/music started individually (no Play pressed, so no
// Playing Scene is tracked) must still stop whenever the GM leaves the open
// Scene, exactly as before — hence the ground-truth teardown in stopScene()
// runs whenever nothing survives the navigation. Effect
// instances always stop on any Scene change (out of scope to change that).
let sceneWatcherRanOnce = false
watch(sceneId, (newId) => {
  // Skip only on the true initial mount — there's nothing to leave yet, so
  // no stop logic applies, only the load. `sceneId` is also `undefined`
  // while on the Scene list (no `:id` route param), so this can't key off
  // "oldId is undefined": that's also true for every list → Scene
  // navigation, which must still run the stop/crossfade logic below.
  if (sceneWatcherRanOnce) {
    const playingId = player.playingSceneId
    // Opening a different Scene than the one currently playing is the only
    // case Scene Crossfade (see CONTEXT.md) applies to — reopening the
    // playing Scene, or navigating while nothing plays, changes nothing.
    const opensADifferentPlayingScene = playingId !== null && !!newId && newId !== playingId
    if (opensADifferentPlayingScene) {
      playback.crossfadeToScene(newId)
        .catch(e => console.error('[scene] crossfadeToScene failed:', e))
    }
    else {
      const survivesNavigation = playingId !== null && (!newId || playingId === newId)
      if (!survivesNavigation)
        stopScene()
    }
    stopAllEffectInstances()
  }
  sceneWatcherRanOnce = true
  // Returning to the list after editing a Scene in place: the list's counts
  // come from `scenes`, which only mount/activation refresh otherwise.
  if (!newId && sceneWatcherRanOnce)
    loadScenes()
  loadScene()
}, { immediate: true })
</script>

<template>
  <main class="scene-view">
    <!-- ═══════ LIST STATE ═══════ -->
    <template v-if="!sceneId">
      <header class="list-header">
        <div class="list-title-row">
          <h1 class="page-title">
            Scenes
          </h1>
          <div class="list-actions">
            <button type="button" class="btn btn-primary" @click="openCreateScene">
              New scene
            </button>
            <button
              type="button"
              class="btn btn-ghost"
              :disabled="importBusy"
              @click="doImportScene"
            >
              {{ importBusy ? 'Importing…' : 'Import' }}
            </button>
            <button type="button" class="btn btn-ghost" @click="showRegistryBrowser = true">
              Browse community
            </button>
          </div>
        </div>
        <p class="page-subtitle">
          Layer music, ambience, and effects into soundboards you can play during your session.
        </p>
      </header>

      <div v-if="showCreateInput" class="create-scene-form">
        <input
          v-model="newSceneName"
          type="text"
          class="input create-scene-input"
          placeholder="Scene name"
          aria-label="Scene name"
          @keydown.enter="submitCreateScene"
          @keydown.escape="cancelCreateScene"
        >
        <div class="create-scene-buttons">
          <button type="button" class="btn btn-ghost" @click="cancelCreateScene">
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!newSceneName.trim() || createSceneBusy"
            @click="submitCreateScene"
          >
            Create
          </button>
        </div>
      </div>

      <p
        v-if="exportImportMessage"
        class="status-message"
        :class="[exportImportMessage.type === 'success' ? 'status-message-success' : 'status-message-error']"
      >
        {{ exportImportMessage.text }}
      </p>

      <p
        v-if="scenesLoadError || soundsLoadError"
        class="status-message status-message-error"
        role="alert"
        data-testid="scene-load-error"
      >
        {{ scenesLoadError ?? soundsLoadError }}
      </p>

      <!-- Scene list -->
      <ul v-if="scenes.length > 0" class="scene-list">
        <li v-for="s in scenes" :key="s.id" class="scene-list-row">
          <RouterLink :to="`/scenes/${s.id}`" class="scene-list-item">
            <span
              v-if="player.playingSceneId === s.id"
              class="playing-badge"
              :title="player.playingSceneMode === LOCAL_TARGET_ID ? 'Playing locally' : 'Playing on Discord'"
              :aria-label="player.playingSceneMode === LOCAL_TARGET_ID ? 'Playing locally' : 'Playing on Discord'"
            >{{ player.playingSceneMode === LOCAL_TARGET_ID ? '🔊' : '💬' }}</span>
            <span class="scene-list-name">{{ s.name }}</span>
            <kbd v-if="s.hotkey" class="hotkey-chip" :title="`Scene Hotkey: ${s.hotkey}`" data-testid="scene-hotkey-chip">{{ s.hotkey }}</kbd>
            <span class="scene-list-counts">
              <span v-if="s.music.length" class="count-badge count-badge-music">{{ s.music.length }} music</span>
              <span v-if="s.ambience.length" class="count-badge count-badge-ambience">{{ s.ambience.length }} ambience</span>
              <span v-if="s.effects.length" class="count-badge count-badge-effects">{{ s.effects.length }} effects</span>
              <span v-if="sceneSoundCount(s) === 0" class="count-badge count-badge-empty">empty</span>
            </span>
            <span v-if="s.updatedAt" class="scene-list-date">{{ formatDate(s.updatedAt) }}</span>
            <span class="scene-list-arrow" aria-hidden="true">›</span>
          </RouterLink>
          <button
            v-if="player.playingSceneId === s.id"
            type="button"
            class="btn-stop-list"
            :aria-label="`Stop ${s.name}`"
            @click="stopPlayingScene"
          >
            Stop
          </button>
        </li>
      </ul>

      <!-- Empty state: no scenes at all -->
      <div v-else-if="!scenesLoadError" class="scene-empty">
        <h2 class="empty-title">
          Get started with scenes
        </h2>
        <p class="empty-desc">
          Scenes let you layer music, ambience, and effects into a soundboard you can trigger during your session.
        </p>
        <div class="empty-actions">
          <button type="button" class="btn btn-primary" @click="openCreateScene">
            Create from scratch
          </button>
          <button type="button" class="btn btn-ghost" @click="showRegistryBrowser = true">
            Browse community scenes
          </button>
        </div>
        <p v-if="!hasSounds" class="empty-hint">
          You can also
          <RouterLink to="/media" class="empty-link">
            add sounds to your library
          </RouterLink>
          first, then build a scene with them.
        </p>
      </div>
    </template>

    <!-- ═══════ DETAIL STATE ═══════ -->
    <template v-else>
      <header class="detail-header">
        <RouterLink to="/scenes" class="back-link">
          <span class="back-arrow" aria-hidden="true">‹</span>
          Scenes
        </RouterLink>
        <div class="detail-title-row">
          <h1 class="detail-title">
            {{ scene?.name ?? (sceneLoadError ? 'Scene unavailable' : 'Loading…') }}
          </h1>
          <HotkeyRecorder
            v-if="scene"
            :model-value="scene.hotkey"
            label="Scene Hotkey"
            :error="hotkeyErrors.scene"
            @update:model-value="bindHotkey('scene', scene, $event)"
          />
          <div v-if="scene" class="detail-actions">
            <button
              v-if="visionAvailable"
              type="button"
              class="btn btn-ghost btn-vision"
              data-testid="vision-to-vibe-open"
              title="Drop in an image and get matching Music and Ambience from your tagged library"
              @click="showVisionDialog = true"
            >
              <span class="btn-vision-icon" aria-hidden="true">✦</span>
              Vision to Vibe
            </button>
            <button
              type="button"
              class="btn btn-ghost"
              :disabled="exportBusy"
              @click="doExportScene"
            >
              {{ exportBusy ? '…' : 'Export' }}
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-danger"
              @click="deleteCurrentScene"
            >
              Delete
            </button>
          </div>
        </div>
      </header>

      <p
        v-if="exportImportMessage"
        class="status-message"
        :class="[exportImportMessage.type === 'success' ? 'status-message-success' : 'status-message-error']"
      >
        {{ exportImportMessage.text }}
      </p>

      <p
        v-if="sceneLoadError || soundsLoadError"
        class="status-message status-message-error"
        role="alert"
        data-testid="scene-load-error"
      >
        {{ sceneLoadError ?? soundsLoadError }}
      </p>

      <div
        v-if="scene"
        class="scene-playback-bar"
        :class="{ 'pulse pulse-flash': sceneTransitionFlash.has(SCENE_START_FLASH) }"
      >
        <label class="global-volume">
          <span class="volume-icon" aria-hidden="true">🔊</span>
          <input
            v-model.number="globalVolume"
            type="range"
            min="0"
            max="100"
            class="volume-slider"
            aria-label="Global volume"
            @change="saveGlobalVolume"
          >
        </label>
        <div class="target-toggle" role="group" aria-label="Output Target">
          <button
            type="button"
            class="btn btn-ghost target-option"
            :class="{ 'target-option-active': !player.isLocalActive }"
            :aria-pressed="!player.isLocalActive"
            title="Play to your Discord voice channel"
            @click="switchTarget('discord')"
          >
            Discord
          </button>
          <button
            type="button"
            class="btn btn-ghost target-option"
            :class="{ 'target-option-active': player.isLocalActive }"
            :aria-pressed="player.isLocalActive"
            title="Play through this computer's speakers"
            @click="switchTarget('local')"
          >
            Local
          </button>
        </div>
        <div class="playback-actions">
          <template v-if="isScenePlayingHere">
            <button
              type="button"
              class="btn btn-stop-scene"
              @click="stopPlayingScene"
            >
              Stop
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              class="btn btn-primary btn-play-scene"
              :title="hasAnySoundMissing ? 'Some sounds are missing — add them to your library first' : !canPlay ? 'Join a voice channel first' : player.isLocalActive ? 'Play this scene through your speakers' : 'Stream this scene to your Discord voice channel'"
              :disabled="!canPlay || hasAnySoundMissing"
              @click="playScene"
            >
              Play
            </button>
          </template>
        </div>
      </div>

      <p v-if="scene" class="now-playing-line">
        {{ nowPlayingLabel }}
      </p>

      <template v-if="scene">
        <section class="scene-section scene-section-ambience">
          <div class="section-header">
            <h2 class="section-title">
              Ambience
            </h2>
            <select
              class="add-select"
              aria-label="Add ambience"
              @change="(e) => { const id = (e.target as HTMLSelectElement).value; if (id) { const s = ambienceSounds.find(x => x.id === id); if (s) addToScene('ambience', s); (e.target as HTMLSelectElement).value = '' } }"
            >
              <option value="">
                Add ambience…
              </option>
              <option
                v-for="s in ambienceSounds.filter(x => !scene.ambience.some(a => a.soundId === x.id))"
                :key="s.id"
                :value="s.id"
              >
                {{ s.name }}
              </option>
            </select>
          </div>
          <div class="sound-cards">
            <div
              v-for="item in scene.ambience"
              :key="item.soundId"
              class="sound-card sound-card-ambience"
              :class="{ 'pulse pulse-breathe': playingAmbienceIds.has(item.soundId) }"
            >
              <div class="sound-card-row">
                <div class="sound-card-info">
                  <span class="sound-name">{{ item.soundName ?? resolveSoundName('ambience', item.soundId) }}</span>
                  <span v-if="isSoundMissing('ambience', item.soundId)" class="sound-missing-badge">
                    missing
                  </span>
                </div>
                <div class="sound-card-controls">
                  <input
                    v-model.number="item.volume"
                    type="range"
                    min="0"
                    max="100"
                    class="volume-slider"
                    :aria-label="`Volume for ${item.soundName ?? resolveSoundName('ambience', item.soundId)}`"
                    @input="updateAmbienceVolume(item)"
                    @change="persistScene(`the volume of ${item.soundName ?? item.soundId}`)"
                  >
                  <label class="toggle">
                    <input
                      v-model="item.enabled"
                      type="checkbox"
                      :aria-label="`Enable ${item.soundName ?? resolveSoundName('ambience', item.soundId)}`"
                      :disabled="isSoundMissing('ambience', item.soundId)"
                      @change="toggleAmbience(item)"
                    >
                  </label>
                  <button
                    type="button"
                    class="btn-icon btn-remove"
                    title="Remove"
                    :aria-label="`Remove ${item.soundName ?? resolveSoundName('ambience', item.soundId)}`"
                    @click="removeFromScene('ambience', item.soundId)"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div v-if="isSoundMissing('ambience', item.soundId)" class="sound-source-hint">
                <button
                  type="button"
                  class="btn-resolve"
                  @click="resolveTarget = { category: 'ambience', item }"
                >
                  Resolve missing sound...
                </button>
              </div>
              <div class="ambience-repeat-row">
                <span class="repeat-label">Repeat every</span>
                <select
                  class="repeat-select"
                  :aria-label="`Shortest repeat interval for ${item.soundName ?? resolveSoundName('ambience', item.soundId)}`"
                  :value="item.repeatMin ?? 0"
                  @change="updateRepeat(item, 'repeatMin', Number(($event.target as HTMLSelectElement).value))"
                >
                  <option
                    v-for="opt in INTERVAL_OPTIONS"
                    :key="opt"
                    :value="opt"
                  >
                    {{ formatInterval(opt) }}
                  </option>
                </select>
                <span class="repeat-label">to</span>
                <select
                  class="repeat-select"
                  :aria-label="`Longest repeat interval for ${item.soundName ?? resolveSoundName('ambience', item.soundId)}`"
                  :value="item.repeatMax ?? 0"
                  @change="updateRepeat(item, 'repeatMax', Number(($event.target as HTMLSelectElement).value))"
                >
                  <option
                    v-for="opt in INTERVAL_OPTIONS.filter(o => o >= (item.repeatMin ?? 0))"
                    :key="opt"
                    :value="opt"
                  >
                    {{ formatInterval(opt) }}
                  </option>
                </select>
              </div>
            </div>
          </div>
          <p v-if="scene.ambience.length === 0" class="section-empty">
            No ambience yet. Ambience loops continuously in the background — rain, wind, tavern chatter. Use the dropdown above to add tracks.
          </p>
        </section>

        <section class="scene-section scene-section-music">
          <div class="section-header">
            <h2 class="section-title">
              Music
            </h2>
            <div class="music-mode-toggle" role="group" aria-label="Music Mode">
              <button
                v-for="option in MUSIC_MODE_OPTIONS"
                :key="option.value"
                type="button"
                class="btn btn-ghost music-mode-option"
                :class="{ 'music-mode-option-active': musicMode === option.value }"
                :aria-pressed="musicMode === option.value"
                :title="option.title"
                @click="setMusicMode(option.value)"
              >
                {{ option.label }}
              </button>
            </div>
            <select
              class="add-select"
              aria-label="Add music"
              @change="(e) => { const id = (e.target as HTMLSelectElement).value; if (id) { const s = musicSounds.find(x => x.id === id); if (s) addToScene('music', s); (e.target as HTMLSelectElement).value = '' } }"
            >
              <option value="">
                Add music…
              </option>
              <option
                v-for="s in musicSounds.filter(x => !scene.music.some(m => m.soundId === x.id))"
                :key="s.id"
                :value="s.id"
              >
                {{ s.name }}
              </option>
            </select>
          </div>
          <div class="sound-cards">
            <div
              v-for="item in scene.music"
              :key="item.soundId"
              class="sound-card"
              :class="{
                'sound-card-has-hint': isSoundMissing('music', item.soundId),
                'sound-card-music-timed': musicProgressFor(item.soundId),
              }"
            >
              <span
                v-if="musicProgressFor(item.soundId)"
                class="music-progress-fill"
                :style="{ width: `${progressPercent(musicProgressFor(item.soundId)!)}%` }"
              />
              <div class="sound-card-main-row">
                <div class="sound-card-info">
                  <span class="sound-name">{{ item.soundName ?? resolveSoundName('music', item.soundId) }}</span>
                  <span v-if="musicProgressFor(item.soundId)" class="music-timer">{{ timerLabel(musicProgressFor(item.soundId)!) }}</span>
                  <span v-if="isSoundMissing('music', item.soundId)" class="sound-missing-badge">
                    missing
                  </span>
                </div>
                <div class="sound-card-controls sound-card-controls-music">
                  <button
                    v-if="playingMusicId === item.soundId"
                    type="button"
                    class="btn-icon btn-icon-active"
                    title="Stop"
                    aria-label="Stop music"
                    @click="stopMusicPlayback"
                  >
                    ■
                  </button>
                  <button
                    v-else
                    type="button"
                    class="btn-icon"
                    :disabled="!canPlay || isSoundMissing('music', item.soundId)"
                    title="Play"
                    :aria-label="`Play ${item.soundName ?? resolveSoundName('music', item.soundId)}`"
                    @click="playMusicTrack(item)"
                  >
                    ▶
                  </button>
                  <input
                    v-model.number="item.volume"
                    type="range"
                    min="0"
                    max="100"
                    class="volume-slider"
                    :aria-label="`Volume for ${item.soundName ?? resolveSoundName('music', item.soundId)}`"
                    @input="updateMusicVolume(item)"
                    @change="persistScene(`the volume of ${item.soundName ?? item.soundId}`)"
                  >
                  <label v-if="musicMode === 'single'" class="toggle" title="Loop">
                    <input v-model="item.loop" type="checkbox" :aria-label="`Loop ${item.soundName ?? resolveSoundName('music', item.soundId)}`" @change="persistScene(`the loop of ${item.soundName ?? item.soundId}`)">
                  </label>
                  <button
                    type="button"
                    class="btn-icon btn-remove"
                    title="Remove"
                    :aria-label="`Remove ${item.soundName ?? resolveSoundName('music', item.soundId)}`"
                    @click="removeFromScene('music', item.soundId)"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div v-if="isSoundMissing('music', item.soundId)" class="sound-source-hint">
                <button
                  type="button"
                  class="btn-resolve"
                  @click="resolveTarget = { category: 'music', item }"
                >
                  Resolve missing sound...
                </button>
              </div>
            </div>
          </div>
          <p v-if="scene.music.length === 0" class="section-empty">
            No music yet. Music plays one track at a time — great for background themes. Use the dropdown above to add tracks.
          </p>
        </section>

        <section class="scene-section scene-section-effects">
          <div class="section-header">
            <h2 class="section-title">
              Effects
            </h2>
            <select
              class="add-select"
              aria-label="Add effect"
              @change="(e) => { const id = (e.target as HTMLSelectElement).value; if (id) { const s = effectsSounds.find(x => x.id === id); if (s) addToScene('effects', s); (e.target as HTMLSelectElement).value = '' } }"
            >
              <option value="">
                Add effect…
              </option>
              <option
                v-for="s in effectsSounds.filter(x => !scene.effects.some(ef => ef.soundId === x.id))"
                :key="s.id"
                :value="s.id"
              >
                {{ s.name }}
              </option>
            </select>
          </div>
          <div class="sound-cards effect-cards">
            <div
              v-for="{ item, status } in effectCards"
              :key="item.soundId"
              class="effect-card"
              :class="{
                'effect-card-missing': isSoundMissing('effects', item.soundId),
                'effect-card-playing': Boolean(status),
                'pulse pulse-flash': effectFlash.has(item.soundId),
              }"
            >
              <button
                type="button"
                class="effect-trigger"
                :disabled="isSoundMissing('effects', item.soundId)"
                :title="isSoundMissing('effects', item.soundId) ? 'Sound missing' : `Play ${item.soundName ?? resolveSoundName('effects', item.soundId)}`"
                @click="playEffect(item)"
              >
                <span
                  v-if="status"
                  class="effect-progress-fill"
                  :style="{ width: `${progressPercent(status)}%` }"
                />
                <span class="effect-trigger-content">
                  <span class="effect-name">{{ item.soundName ?? resolveSoundName('effects', item.soundId) }}</span>
                  <span v-if="status" class="effect-timer">{{ timerLabel(status) }}</span>
                </span>
                <span v-if="isSoundMissing('effects', item.soundId)" class="sound-missing-badge">
                  missing
                </span>
                <span v-if="status && status.count > 1" class="effect-count-badge">
                  ×{{ status.count }}
                </span>
              </button>
              <button
                v-if="status"
                type="button"
                class="btn-icon effect-stop"
                title="Stop"
                :aria-label="`Stop ${item.soundName ?? resolveSoundName('effects', item.soundId)}`"
                @click="player.stopEffectSound(item.soundId)"
              >
                ■
              </button>
              <button
                type="button"
                class="btn-icon btn-remove effect-remove"
                title="Remove"
                :aria-label="`Remove ${item.soundName ?? resolveSoundName('effects', item.soundId)}`"
                @click="removeFromScene('effects', item.soundId)"
              >
                ×
              </button>
              <HotkeyRecorder
                class="effect-hotkey-recorder"
                compact
                data-testid="effect-hotkey-recorder"
                :model-value="item.hotkey"
                :label="`Effect Hotkey for ${item.soundName ?? resolveSoundName('effects', item.soundId)}`"
                :error="hotkeyErrors[`effect:${item.soundId}`]"
                @update:model-value="bindHotkey(`effect:${item.soundId}`, item, $event)"
              />
              <div v-if="isSoundMissing('effects', item.soundId)" class="sound-source-hint effect-resolve-hint">
                <button
                  type="button"
                  class="btn-resolve"
                  @click="resolveTarget = { category: 'effects', item }"
                >
                  Resolve…
                </button>
              </div>
            </div>
          </div>
          <p v-if="scene.effects.length === 0" class="section-empty">
            No effects yet. Effects are one-shot sounds you trigger on demand — a thunder clap, a door slam. Use the dropdown above to add some.
          </p>
        </section>
      </template>
    </template>

    <!-- ═══════ OVERLAYS ═══════ -->
    <RegistryBrowser
      v-if="showRegistryBrowser"
      @close="showRegistryBrowser = false"
      @installed="onRegistryInstalled"
    />

    <VisionToVibeDialog
      v-if="showVisionDialog && scene"
      :music-sounds="musicSounds"
      :ambience-sounds="ambienceSounds"
      :music-in-scene="scene.music.map(m => m.soundId)"
      :ambience-in-scene="scene.ambience.map(a => a.soundId)"
      :provider="visionProvider"
      :endpoint="visionEndpoint"
      @add="addToScene"
      @close="showVisionDialog = false"
    />

    <ResolveSoundDialog
      v-if="resolveTarget"
      :item="resolveTarget.item"
      :category="resolveTarget.category"
      :sounds="resolveTarget.category === 'ambience' ? ambienceSounds : resolveTarget.category === 'music' ? musicSounds : effectsSounds"
      @resolved="async (id: string, name: string) => { await relinkSound(resolveTarget!.category, resolveTarget!.item, id, name); resolveTarget = null }"
      @close="resolveTarget = null"
    />
  </main>
</template>

<style scoped>
.scene-view {
  display: flex;
  flex-direction: column;
}

/* ═══════ LIST STATE ═══════ */

.list-header {
  margin-bottom: 1.5rem;
}

.list-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.page-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.page-subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.list-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* ── Scene list ── */

.scene-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.scene-list-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.scene-list-item {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  text-decoration: none;
  color: var(--color-text);
  transition: background var(--transition);
  min-width: 0;
}

.scene-list-item:hover {
  background: var(--color-bg-card);
}

.playing-badge {
  color: var(--color-accent);
  font-size: 0.7rem;
  flex-shrink: 0;
}

.btn-stop-list {
  flex-shrink: 0;
  padding: 0.3rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--color-error-muted);
  color: var(--color-error);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.btn-stop-list:hover {
  background: var(--color-error);
  color: var(--color-on-accent-bg);
}

.scene-list-name {
  font-size: 0.85rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.scene-list-counts {
  display: flex;
  gap: 0.35rem;
  flex-shrink: 0;
  margin-left: auto;
}

.count-badge {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 0.1rem 0.35rem;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}

.count-badge-music {
  background: rgba(245, 158, 11, 0.1);
  color: var(--color-music);
}

.count-badge-ambience {
  background: rgba(45, 212, 191, 0.1);
  color: var(--color-ambience);
}

.count-badge-effects {
  background: var(--color-effects-muted);
  color: var(--color-effects);
}

.count-badge-empty {
  background: var(--color-bg-elevated);
  color: var(--color-text-dim);
}

.scene-list-date {
  font-size: 0.75rem;
  color: var(--color-text-dim);
  flex-shrink: 0;
  white-space: nowrap;
}

.scene-list-arrow {
  font-size: 1.1rem;
  color: var(--color-text-dim);
  flex-shrink: 0;
  line-height: 1;
}

/* ═══════ DETAIL STATE ═══════ */

.detail-header {
  margin-bottom: 0.25rem;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-muted);
  text-decoration: none;
  transition: color var(--transition);
}

.back-link:hover {
  color: var(--color-accent);
}

.back-arrow {
  font-size: 1.1rem;
  line-height: 1;
}

.detail-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-top: 0.35rem;
}

.detail-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

/* ── Create scene form ── */

.create-scene-form {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0.75rem 1rem;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  margin-bottom: 1rem;
}

.create-scene-input {
  font-size: 1rem;
  font-weight: 500;
  border-radius: var(--radius-md);
  min-width: 200px;
  flex: 1;
}

.create-scene-buttons {
  display: flex;
  gap: 0.5rem;
}

/* ── Playback bar ── */

.scene-playback-bar {
  --pulse-color: var(--color-accent);
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.global-volume {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.volume-icon {
  font-size: 1rem;
}

.volume-slider {
  width: 120px;
  accent-color: var(--color-accent);
}

.playback-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.target-toggle {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.target-option {
  border: none;
  border-radius: 0;
  font-size: 0.8rem;
}

.target-option-active {
  background: var(--color-accent-muted);
  color: var(--color-text);
}

.btn-play-scene {
  padding: 0.5rem 1.5rem;
  font-size: 1rem;
  box-shadow: var(--shadow-accent-sm);
}

.btn-play-scene:hover:not(:disabled) {
  box-shadow: var(--shadow-accent-md);
}

.btn-stop-scene {
  padding: 0.5rem 1.5rem;
  font-size: 1rem;
  background: var(--color-error-muted);
  color: var(--color-error);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.btn-stop-scene:hover {
  background: var(--color-error);
  color: var(--color-on-accent-bg);
}

/* ═══════ EMPTY STATE ═══════ */

.scene-empty {
  text-align: center;
  margin-top: 2.5rem;
  padding: 3rem 2rem;
  background: var(--color-bg-card);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
}

.empty-title {
  margin: 0 0 0.5rem;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text);
}

.empty-desc {
  margin: 0 0 1.25rem;
  font-size: 0.85rem;
  max-width: 440px;
  margin-inline: auto;
  line-height: 1.5;
}

.empty-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  flex-wrap: wrap;
}

.empty-hint {
  margin: 1rem 0 0;
  font-size: 0.8rem;
}

.empty-link {
  color: var(--color-accent);
  text-decoration: none;
}

.empty-link:hover {
  text-decoration: underline;
}

.now-playing-line {
  display: none;
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

/* ═══════ SCENE SECTIONS ═══════ */

.scene-section {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--section-color, var(--color-border));
  border-radius: var(--radius-lg);
  padding: 1rem 1.25rem;
  margin-top: 1.5rem;
}

.scene-section:first-of-type {
  margin-top: 1.25rem;
}

.scene-section-ambience {
  --section-color: var(--color-ambience);
}

.scene-section-music {
  --section-color: var(--color-music);
}

.scene-section-effects {
  --section-color: var(--color-effects);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.music-mode-toggle {
  display: inline-flex;
  margin-left: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.music-mode-option {
  border: none;
  border-radius: 0;
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
}

.music-mode-option-active {
  background: var(--color-accent-muted);
  color: var(--color-text);
}

.section-title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--section-color, var(--color-text-dim));
}

/* ── Sound cards (Ambience & Music) ── */

.sound-cards {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sound-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.6rem 0.75rem;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.sound-card-ambience {
  --pulse-color: var(--color-ambience);
  flex-direction: column;
  align-items: stretch;
  gap: 0.35rem;
}

.sound-card-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.ambience-repeat-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  padding-left: 0.125rem;
}

.repeat-label {
  white-space: nowrap;
}

.repeat-select {
  padding: 0.15rem 0.35rem;
  font-size: 0.75rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
}

.sound-card-music-timed {
  position: relative;
  overflow: hidden;
}

/* The playing Music track's progress (#695): a thin bar along the card's
   bottom edge, no transition, so a Stop removes it at once. */
.music-progress-fill {
  position: absolute;
  inset: auto auto 0 0;
  height: 2px;
  background: var(--color-music);
  opacity: 0.7;
}

.music-timer {
  flex-shrink: 0;
  font-size: 0.7rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.sound-card-info {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.sound-name {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sound-card-has-hint {
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;
}

.sound-card-main-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.sound-missing-badge {
  display: inline-block;
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.1rem 0.35rem;
  background: var(--color-error-muted);
  color: var(--color-error);
  border-radius: var(--radius-sm);
  vertical-align: middle;
  flex-shrink: 0;
}

.sound-source-hint {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  padding: 0.4rem 0.6rem;
  background: var(--color-bg);
  border-radius: var(--radius-sm);
  line-height: 1.5;
}

.btn-resolve {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-accent);
  font-size: 0.8rem;
  font-weight: 500;
  padding: 0.25rem 0.6rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.btn-resolve:hover {
  background: var(--color-bg-elevated);
  border-color: var(--color-accent);
}

.sound-card-controls {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-shrink: 0;
}

.sound-card-controls-music {
  gap: 0.5rem;
}

.btn-icon {
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.8rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-icon:hover:not(:disabled) {
  background: var(--color-border);
}

.btn-icon-active {
  background: var(--color-error-muted);
  color: var(--color-error);
}

.btn-icon-active:hover {
  background: var(--color-error);
  color: var(--color-on-accent-bg);
}

.toggle input {
  accent-color: var(--color-accent);
}

.add-select {
  padding: 0.3rem 0.5rem;
  font-size: 0.8rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
}

.btn-remove {
  color: var(--color-text-muted);
  font-size: 1.1rem;
  line-height: 1;
}

.btn-remove:hover {
  color: var(--color-error);
}

/* ── Effects: dense trigger grid ── */

.effect-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.5rem;
}

.effect-card {
  --pulse-color: var(--color-effects);
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.effect-trigger {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.75rem;
  padding-right: 2rem;
  background: none;
  border: none;
  color: var(--color-text);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  transition: background 0.15s;
}

.effect-trigger:hover:not(:disabled) {
  background: var(--color-effects-muted);
}

.effect-trigger:active:not(:disabled) {
  background: var(--color-effects-muted-hover);
}

.effect-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Sweeps across the trigger button as the longest-remaining instance
   plays out — a plain width percentage, no transition: a mid-playback Stop
   or eviction must make this disappear instantly, not animate out. */
.effect-progress-fill {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 0;
  background: var(--color-effects-muted);
}

.effect-trigger-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  flex: 1;
}

.effect-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.effect-timer {
  font-size: 0.7rem;
  font-weight: 400;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.effect-count-badge {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-effects);
}

.effect-card-playing .effect-trigger {
  padding-right: 3.75rem;
}

.effect-stop,
.effect-remove {
  position: absolute;
  top: 0.35rem;
  right: 0.25rem;
  z-index: 2;
  width: 1.5rem;
  height: 1.5rem;
}

.effect-stop {
  font-size: 0.7rem;
  background: var(--color-bg);
  color: var(--color-effects);
}

.effect-remove {
  font-size: 1rem;
  background: transparent;
  opacity: 0;
  transition: opacity 0.15s;
}

.effect-card-playing .effect-remove {
  right: 2rem;
}

.effect-card:hover .effect-remove {
  opacity: 1;
}

.effect-hotkey-recorder {
  padding: 0 0.75rem 0.45rem;
}

.effect-card-missing {
  border-color: var(--color-error-muted);
}

.effect-resolve-hint {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

/* ── Shared ── */

.section-empty {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.btn-danger:hover {
  color: var(--color-error);
}

.btn-vision {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border-color: var(--color-accent-muted);
  color: var(--color-accent-hover);
}

.btn-vision:hover:not(:disabled) {
  background: var(--color-accent-muted);
  color: var(--color-accent-hover);
}

.btn-vision-icon {
  font-size: 0.85em;
}

/* ── Compact session layout: Scene editing hidden, Effects + playback only ──
   899.98px (not 900px) keeps "900px and above unchanged" exact — max-width is
   inclusive, so matching exactly 900 here would also catch the 900px boundary.
   Kept in sync with the matching breakpoint in App.vue. */

@media (max-width: 899.98px) {
  .detail-actions {
    display: none;
  }

  .scene-section-ambience,
  .scene-section-music {
    display: none;
  }

  .scene-section-effects .add-select,
  .effect-remove,
  .effect-resolve-hint {
    display: none;
  }

  .now-playing-line {
    display: block;
  }
}

/* ── Narrow ── */

@media (max-width: 560px) {
  .list-title-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .detail-title-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }

  .scene-list-counts {
    display: none;
  }

  .scene-list-date {
    display: none;
  }

  .scene-playback-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }

  .playback-actions {
    margin-left: 0;
    justify-content: flex-end;
  }
}
</style>
