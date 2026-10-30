<script setup lang="ts">
import type { VisionProviderId } from '@/api/config'
import type { MusicMode, Scene, SceneItem } from '@/api/scenes'
import type { SoundFile } from '@/api/sounds'
import type { SceneCategory } from '@/components/scene/scene-format'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onActivated, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { fetchVisionConfig, LOCAL_TARGET_ID, openFileDialog, saveFileDialog } from '@/api/config'
import { deleteScene, exportScene, getScene, importScene, listScenes, moveScene, saveScene } from '@/api/scenes'
import { listAmbience, listEffects, listMusic } from '@/api/sounds'
import { logInfo } from '@/audio/audio-element-diagnostics'
import { normalizeMusicMode } from '@/audio/music-mode'
import RegistryBrowser from '@/components/RegistryBrowser.vue'
import ResolveSoundDialog from '@/components/ResolveSoundDialog.vue'
import AmbienceCard from '@/components/scene/AmbienceCard.vue'
import EffectsCard from '@/components/scene/EffectsCard.vue'
import MusicCard from '@/components/scene/MusicCard.vue'
import { isMissingFrom } from '@/components/scene/scene-format'
import SceneHeader from '@/components/scene/SceneHeader.vue'
import ScenePlaybackBar from '@/components/scene/ScenePlaybackBar.vue'
import VisionToVibeDialog from '@/components/VisionToVibeDialog.vue'
import { usePlayerStore } from '@/stores/player'
import { useScenePlaybackStore } from '@/stores/scene-playback'
import { useToastStore } from '@/stores/toast'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()
const toast = useToastStore()
// Scene orchestration (play/stop, Scene Crossfade, renderer-fallback audio)
// lives in the store so it survives leaving this view. This view owns the
// Scene list and the open Scene (loading, saving, rollback); the header,
// playback bar and category cards under components/scene render it.
const playback = useScenePlaybackStore()
const { playingMusicId, musicSounds } = storeToRefs(playback)
const { stopScene, stopAmbience, stopMusicPlayback, stopAllEffectInstances, updateAmbienceVolume, updateMusicVolume } = playback

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
const resolveTarget = ref<{ category: SceneCategory, item: SceneItem } | null>(null)
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

const sceneId = computed(() => {
  if (route.path === '/scenes' || route.path.startsWith('/scenes/'))
    return route.params.id as string
  return undefined
})

const hasSounds = computed(() =>
  ambienceSounds.value.length > 0 || musicSounds.value.length > 0 || effectsSounds.value.length > 0,
)

const hasAnySoundMissing = computed(() => {
  const s = scene.value
  if (!s)
    return false
  return (['ambience', 'music', 'effects'] as const)
    .some(category => s[category].some(item => isMissingFrom(librarySounds(category), item.soundId)))
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

/** The Sound Library half a category's Scene items come from. */
function librarySounds(category: SceneCategory): SoundFile[] {
  return category === 'ambience'
    ? ambienceSounds.value
    : category === 'music'
      ? musicSounds.value
      : effectsSounds.value
}

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

async function addToScene(category: SceneCategory, sound: SoundFile) {
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

async function removeFromScene(category: SceneCategory, soundId: string) {
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

// Scene order (#697): the list order is the `scenes.json` order that
// Previous/Next Scene walk. Moves apply locally at once and are saved one at a
// time, in order; a failed save reloads the stored order and drops the moves
// still queued behind it, whose positions were picked against the discarded
// order.
const draggedSceneId = ref<string | null>(null)
const dropTargetSceneId = ref<string | null>(null)
const sceneOrderAnnouncement = ref('')
let pendingSceneMoves: Promise<void> = Promise.resolve()
let sceneMoveGeneration = 0

const ARROW_STEPS: Record<string, number> = { ArrowUp: -1, ArrowDown: 1 }

function sceneIndex(id: string): number {
  return scenes.value.findIndex(s => s.id === id)
}

function moveSceneTo(id: string, toIndex: number): Promise<void> {
  const from = sceneIndex(id)
  if (from === -1 || toIndex < 0 || toIndex >= scenes.value.length || toIndex === from)
    return pendingSceneMoves
  const next = [...scenes.value]
  const [moved] = next.splice(from, 1)
  next.splice(toIndex, 0, moved)
  scenes.value = next
  sceneOrderAnnouncement.value = `${moved.name} moved to position ${toIndex + 1} of ${next.length}`
  logInfo(`[scenes] Moving scene ${id} from position ${from + 1} to ${toIndex + 1}`)
  const generation = sceneMoveGeneration
  pendingSceneMoves = pendingSceneMoves.then(async () => {
    if (generation !== sceneMoveGeneration) {
      logInfo(`[scenes] Dropped queued move of scene ${id}: an earlier move failed and the saved order was reloaded`)
      return
    }
    try {
      await moveScene(id, toIndex)
    }
    catch (err) {
      console.warn(`[scenes] move failed for scene ${id}:`, err)
      toast.show({ type: 'error', text: `Couldn't move "${moved.name}". Try again.` })
      await loadScenes()
      sceneMoveGeneration++
    }
  })
  return pendingSceneMoves
}

async function onSceneGripKeydown(event: KeyboardEvent, id: string) {
  const step = ARROW_STEPS[event.key]
  if (!step)
    return
  event.preventDefault()
  void moveSceneTo(id, sceneIndex(id) + step)
  // Re-rendering the moved row can drop focus; keep it on the grip so the GM
  // can keep stepping.
  await nextTick()
  document.querySelector<HTMLElement>(`[data-scene-grip="${CSS.escape(id)}"]`)?.focus()
}

/** Where the dragged Scene would land relative to this row: above it when moving up, below when moving down. */
function dropIndicator(id: string): string {
  const dragged = draggedSceneId.value
  if (!dragged || dropTargetSceneId.value !== id || dragged === id)
    return ''
  return sceneIndex(id) < sceneIndex(dragged)
    ? 'scene-list-row-drop-before'
    : 'scene-list-row-drop-after'
}

function onSceneDragStart(event: DragEvent, id: string) {
  draggedSceneId.value = id
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', id)
    const row = (event.currentTarget as HTMLElement | null)?.closest('li')
    if (row)
      event.dataTransfer.setDragImage(row, 16, 16)
  }
}

function onSceneDragOver(event: DragEvent, id: string) {
  if (!draggedSceneId.value)
    return
  event.preventDefault()
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = 'move'
  dropTargetSceneId.value = id
}

function onSceneDrop(event: DragEvent, id: string) {
  const dragged = draggedSceneId.value
  onSceneDragEnd()
  if (!dragged)
    return
  event.preventDefault()
  void moveSceneTo(dragged, sceneIndex(id))
}

function onSceneDragLeave(event: DragEvent, id: string) {
  // Moving onto a child of the same row fires dragleave too; only clear when leaving the row.
  const row = event.currentTarget as HTMLElement | null
  if (dropTargetSceneId.value === id && !(event.relatedTarget instanceof Node && row?.contains(event.relatedTarget)))
    dropTargetSceneId.value = null
}

function onSceneDragEnd() {
  draggedSceneId.value = null
  dropTargetSceneId.value = null
}

// The open Scene need not be the Playing Scene: a Scene Hotkey or
// Previous/Next plays another one without navigating (#715). Deleting the
// Playing Scene, or one opened while nothing plays, tears everything down;
// otherwise only what this Scene started individually stops, leaving the
// Playing Scene's own Ambience and Music alone.
async function stopDeletedScenePlayback(deleted: Scene) {
  const playingId = player.playingSceneId
  if (playingId === null || playingId === deleted.id) {
    logInfo(`[scenes] Deleted scene ${deleted.id} ${playingId === null
      ? 'with nothing playing'
      : 'was the Playing Scene'}, stopping all playback`)
    stopScene()
    return
  }
  let playingAmbience = new Set<string>()
  try {
    const playing = await getScene(playingId)
    playingAmbience = new Set(playing?.ambience.map(i => i.soundId) ?? [])
  }
  catch (err) {
    console.warn(`[scenes] Couldn't read Playing Scene ${playingId} while deleting scene ${deleted.id}, stopping all of its Ambience:`, err)
  }
  const ambience = deleted.ambience
    .map(i => i.soundId)
    .filter(soundId => !playingAmbience.has(soundId))
  for (const soundId of ambience)
    stopAmbience(soundId)
  const music = playingMusicId.value
  const stopsMusic = music !== null
    && deleted.music.some(i => i.soundId === music)
    && playback.musicSceneId !== playingId
  if (stopsMusic)
    stopMusicPlayback()
  logInfo(`[scenes] Deleted scene ${deleted.id} while Scene ${playingId} plays, keeping it; stopped its Ambience [${ambience.join(', ')}]${stopsMusic
    ? `, Music ${music}`
    : ''}`)
}

async function deleteCurrentScene() {
  // eslint-disable-next-line no-alert -- simple confirm for destructive action
  if (!scene.value || !confirm(`Delete "${scene.value.name}"? This can't be undone.`))
    return
  const deleted = scene.value
  const { id, name } = deleted
  logInfo(`[scenes] Deleting scene ${id}`)
  try {
    await deleteScene(id)
  }
  catch (err) {
    console.warn(`[scenes] delete failed for scene ${id}:`, err)
    toast.show({ type: 'error', text: `Couldn't delete "${name}". Try again.` })
    return
  }
  // Only once it is gone.
  await stopDeletedScenePlayback(deleted)
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

/** The library sounds a missing item may be relinked to: none already listed elsewhere in its category. */
function relinkCandidates(category: SceneCategory, item: SceneItem): SoundFile[] {
  const listed = new Set((scene.value?.[category] ?? []).filter(i => i !== item).map(i => i.soundId))
  return librarySounds(category).filter(s => !listed.has(s.id))
}

async function relinkSound(category: SceneCategory, item: SceneItem, soundId: string, soundName: string) {
  if (!scene.value)
    return
  const previous = item.soundName ?? item.soundId
  // A second item with the same id would share its card key and playback (#715).
  if (scene.value[category].some(i => i !== item && i.soundId === soundId)) {
    console.warn(`[scenes] relink of ${item.soundId} to ${soundId} refused in scene ${scene.value.id}: ${category} already lists it`)
    toast.show({ type: 'error', text: `${soundName} is already in this scene's ${category}.` })
    return
  }
  logInfo(`[scenes] Relinking ${category} item ${item.soundId} to ${soundId} in scene ${scene.value.id}`)
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
  playback.loadMasterVolume()
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
      <p class="sr-only" aria-live="polite" data-testid="scene-order-status">
        {{ sceneOrderAnnouncement }}
      </p>
      <ul v-if="scenes.length > 0" class="scene-list">
        <li
          v-for="s in scenes"
          :key="s.id"
          class="scene-list-row"
          :class="[draggedSceneId === s.id ? 'scene-list-row-dragging' : '', dropIndicator(s.id)]"
          @dragover="onSceneDragOver($event, s.id)"
          @dragleave="onSceneDragLeave($event, s.id)"
          @drop="onSceneDrop($event, s.id)"
        >
          <button
            type="button"
            class="scene-grip"
            draggable="true"
            :data-scene-grip="s.id"
            :aria-label="`Reorder ${s.name}`"
            aria-keyshortcuts="ArrowUp ArrowDown"
            title="Drag to reorder, or press ↑ / ↓"
            @keydown="onSceneGripKeydown($event, s.id)"
            @dragstart="onSceneDragStart($event, s.id)"
            @dragend="onSceneDragEnd"
          >
            <span aria-hidden="true">⠿</span>
          </button>
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
            @click="stopScene()"
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
      <SceneHeader
        :scene="scene"
        :load-error="sceneLoadError"
        :hotkey-error="hotkeyErrors.scene"
        :vision-available="visionAvailable"
        :export-busy="exportBusy"
        @bind-hotkey="scene && bindHotkey('scene', scene, $event)"
        @open-vision="showVisionDialog = true"
        @export="doExportScene"
        @delete="deleteCurrentScene"
      />

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

      <template v-if="scene">
        <ScenePlaybackBar :scene="scene" :has-any-sound-missing="hasAnySoundMissing" />

        <AmbienceCard
          :items="scene.ambience"
          :sounds="ambienceSounds"
          @add="addToScene('ambience', $event)"
          @remove="removeFromScene('ambience', $event)"
          @resolve="resolveTarget = { category: 'ambience', item: $event }"
          @persist="persistScene"
        />

        <MusicCard
          :items="scene.music"
          :sounds="musicSounds"
          :music-mode="musicMode"
          @update:music-mode="setMusicMode"
          @add="addToScene('music', $event)"
          @remove="removeFromScene('music', $event)"
          @resolve="resolveTarget = { category: 'music', item: $event }"
          @persist="persistScene"
        />

        <EffectsCard
          :items="scene.effects"
          :sounds="effectsSounds"
          :hotkey-errors="hotkeyErrors"
          @add="addToScene('effects', $event)"
          @remove="removeFromScene('effects', $event)"
          @resolve="resolveTarget = { category: 'effects', item: $event }"
          @bind-hotkey="bindHotkey"
        />
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
      :sounds="relinkCandidates(resolveTarget.category, resolveTarget.item)"
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

.scene-list-row-dragging {
  opacity: 0.5;
}

.scene-list-row-drop-before {
  box-shadow: inset 0 2px 0 var(--color-accent);
}

.scene-list-row-drop-after {
  box-shadow: inset 0 -2px 0 var(--color-accent);
}

.scene-grip {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.75rem;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-text-dim);
  font-size: 0.9rem;
  cursor: grab;
  transition: color var(--transition), background var(--transition);
}

.scene-grip:hover,
.scene-grip:focus-visible {
  color: var(--color-text);
  background: var(--color-bg-card);
}

.scene-grip:active {
  cursor: grabbing;
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

/* ── Narrow ── */

@media (max-width: 560px) {
  .list-title-row {
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
}
</style>
