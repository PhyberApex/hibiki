<script setup lang="ts">
import type { Scene, SceneItem } from '@/api/scenes'
import type { SoundFile } from '@/api/sounds'
import type { CaptureSession } from '@/audio/browser-audio-capture'
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import {
  sendAudioChunk,
  sendEffectChunk,
  startAudioStream,
  startEffectStream,
  stopAudioStream,
  stopEffectStream,
} from '@/api/audio-stream'
import { openFileDialog, saveFileDialog } from '@/api/config'
import { deleteScene, exportScene, getScene, importScene, listScenes, saveScene } from '@/api/scenes'
import { listAmbience, listEffects, listMusic, soundStreamUrl } from '@/api/sounds'
import {
  captureFromAudioElement,
} from '@/audio/browser-audio-capture'
import RegistryBrowser from '@/components/RegistryBrowser.vue'
import ResolveSoundDialog from '@/components/ResolveSoundDialog.vue'
import { usePlayerStore } from '@/stores/player'

const route = useRoute()
const router = useRouter()
const player = usePlayerStore()

const scenes = ref<Scene[]>([])
const scene = ref<Scene | null>(null)
const ambienceSounds = ref<SoundFile[]>([])
const musicSounds = ref<SoundFile[]>([])
const effectsSounds = ref<SoundFile[]>([])
const globalVolume = ref(80)
const playingMusicId = ref<string | null>(null)
const scenePlayingLocal = ref(false)
const showCreateInput = ref(false)
const newSceneName = ref('')
const createSceneBusy = ref(false)
const exportBusy = ref(false)
const importBusy = ref(false)
const showRegistryBrowser = ref(false)
const resolveTarget = ref<{ category: 'ambience' | 'music' | 'effects', item: SceneItem } | null>(null)
const loadError = ref<string | null>(null)
const exportImportMessage = ref<{ type: 'success' | 'error', text: string } | null>(null)
const musicAudioEl = createAudioEl()
const effectAudioEl = createAudioEl()
const ambienceAudioEls = new Map<string, HTMLAudioElement>()
const captureSessions = new Map<string, CaptureSession>()
const ambienceTimers = new Map<string, ReturnType<typeof setTimeout>>()

function createAudioEl(): HTMLAudioElement {
  const el = new Audio()
  el.crossOrigin = 'anonymous'
  return el
}

function getAmbienceAudio(soundId: string): HTMLAudioElement {
  let el = ambienceAudioEls.get(soundId)
  if (!el) {
    el = createAudioEl()
    ambienceAudioEls.set(soundId, el)
  }
  return el
}

const INTERVAL_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, 600]

function formatInterval(seconds: number): string {
  if (seconds === 0)
    return '0s'
  if (seconds < 60)
    return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function updateRepeat(item: SceneItem, field: 'repeatMin' | 'repeatMax', value: number) {
  item[field] = value
  if (field === 'repeatMin' && (item.repeatMax ?? 0) < value)
    item.repeatMax = value
  if (field === 'repeatMax' && value < (item.repeatMin ?? 0))
    item.repeatMin = value
  saveScene(scene.value!).catch(() => {})
}

const sceneId = computed(() => {
  if (route.path === '/scenes' || route.path.startsWith('/scenes/'))
    return route.params.id as string
  return undefined
})
const guildId = computed(() => player.guildId)
const isJoined = computed(() => player.isJoined)
const hasSounds = computed(() =>
  ambienceSounds.value.length > 0 || musicSounds.value.length > 0 || effectsSounds.value.length > 0,
)

const hasAnySoundMissing = computed(() => {
  if (!scene.value)
    return false
  return [...scene.value.ambience, ...scene.value.music, ...scene.value.effects]
    .some(item => isSoundMissing(
      scene.value!.ambience.includes(item) ? 'ambience' : scene.value!.music.includes(item) ? 'music' : 'effects',
      item.soundId,
    ))
})

function sceneSoundCount(s: Scene): number {
  return s.ambience.length + s.music.length + s.effects.length
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  if (d.getFullYear() === now.getFullYear())
    return `${months[d.getMonth()]} ${d.getDate()}`
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

function resolveSoundName(category: 'ambience' | 'music' | 'effects', soundId: string): string {
  const list = category === 'ambience' ? ambienceSounds.value : category === 'music' ? musicSounds.value : effectsSounds.value
  return list.find(s => s.id === soundId)?.name ?? soundId
}

function computeVolume(itemVolume: number): number {
  return (itemVolume / 100) * (globalVolume.value / 100)
}

function updateAmbienceVolume(item: SceneItem) {
  const el = ambienceAudioEls.get(item.soundId)
  if (el)
    el.volume = computeVolume(item.volume ?? 80)
}

function updateMusicVolume(item: SceneItem) {
  if (playingMusicId.value === item.soundId)
    musicAudioEl.volume = computeVolume(item.volume ?? 80)
}

function updateAllVolumes() {
  if (!scene.value)
    return
  for (const item of scene.value.ambience)
    updateAmbienceVolume(item)
  const musicItem = scene.value.music.find(m => m.soundId === playingMusicId.value)
  if (musicItem)
    updateMusicVolume(musicItem)
}

watch(globalVolume, () => updateAllVolumes())

async function loadScenes() {
  try {
    scenes.value = await listScenes()
  }
  catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Couldn\'t load scenes. Try again.'
  }
}

async function loadScene() {
  if (sceneId.value === undefined || !sceneId.value) {
    scene.value = null
    return
  }
  try {
    scene.value = await getScene(sceneId.value)
  }
  catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Couldn\'t load this scene. Try again.'
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
  }
  catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Couldn\'t load sounds. Try again.'
  }
}

function toggleAmbience(item: SceneItem) {
  saveScene(scene.value!).catch(() => {})
  if (item.enabled && isJoined.value && guildId.value)
    playAmbience(item)
  else
    stopAmbience(item.soundId)
}

function stopAmbience(soundId: string) {
  const timer = ambienceTimers.get(soundId)
  if (timer != null) {
    clearTimeout(timer)
    ambienceTimers.delete(soundId)
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
  stopEffectStream(guildId.value!, `ambience-${soundId}`).catch(() => {})
}

function stopAmbienceLocal(soundId: string) {
  const timer = ambienceTimers.get(soundId)
  if (timer != null) {
    clearTimeout(timer)
    ambienceTimers.delete(soundId)
  }
  const el = ambienceAudioEls.get(soundId)
  if (el) {
    el.onended = null
    el.pause()
    el.removeAttribute('src')
    el.load()
  }
}

function isLooping(item: SceneItem): boolean {
  return (item.repeatMin ?? 0) === 0 && (item.repeatMax ?? 0) === 0
}

async function playAmbience(item: SceneItem) {
  if (!guildId.value || !isJoined.value)
    return
  try {
    stopAmbience(item.soundId)
    const el = getAmbienceAudio(item.soundId)
    const streamId = `ambience-${item.soundId}`
    await startEffectStream(guildId.value, streamId)
    el.src = soundStreamUrl('ambience', item.soundId)
    el.loop = isLooping(item)
    el.volume = (item.volume ?? 80) / 100 * (globalVolume.value / 100)
    el.load()
    await new Promise<void>((resolve, reject) => {
      el.addEventListener('canplaythrough', () => resolve(), { once: true })
      el.addEventListener('error', () => reject(el.error ?? new Error('Audio load failed')), { once: true })
    })
    const onChunk = (chunk: ArrayBuffer) => sendEffectChunk(guildId.value!, chunk, streamId)
    const sess = await captureFromAudioElement(el, onChunk)
    captureSessions.set(`ambience-${item.soundId}`, sess)

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
  }
  catch (e) {
    console.error('[scene] playAmbience failed:', e)
    stopAmbience(item.soundId)
  }
}

async function playAmbienceLocal(item: SceneItem) {
  try {
    stopAmbienceLocal(item.soundId)
    const el = getAmbienceAudio(item.soundId)
    el.src = soundStreamUrl('ambience', item.soundId)
    el.loop = isLooping(item)
    el.volume = (item.volume ?? 80) / 100 * (globalVolume.value / 100)
    el.load()
    await new Promise<void>((resolve, reject) => {
      el.addEventListener('canplaythrough', () => resolve(), { once: true })
      el.addEventListener('error', () => reject(el.error ?? new Error('Audio load failed')), { once: true })
    })
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
  }
  catch (e) {
    console.error('[scene] playAmbienceLocal failed:', e)
    stopAmbienceLocal(item.soundId)
  }
}

async function playMusic(item: SceneItem) {
  if (!guildId.value || !isJoined.value)
    return
  try {
    stopMusic()
    const track = musicSounds.value.find(s => s.id === item.soundId)
    if (!track)
      return
    const el = musicAudioEl
    playingMusicId.value = item.soundId
    await startAudioStream(guildId.value, {
      id: track.id,
      name: track.name,
      filename: track.filename,
      category: 'music',
    })
    el.src = soundStreamUrl('music', item.soundId)
    el.loop = item.loop ?? false
    el.volume = (item.volume ?? 80) / 100 * (globalVolume.value / 100)
    el.load()
    await new Promise<void>((resolve, reject) => {
      el.addEventListener('canplaythrough', () => resolve(), { once: true })
      el.addEventListener('error', () => reject(el.error ?? new Error('Audio load failed')), { once: true })
    })
    const onChunk = (chunk: ArrayBuffer) => sendAudioChunk(guildId.value!, chunk)
    const sess = await captureFromAudioElement(el, onChunk)
    captureSessions.set('music', sess)
    el.onended = () => {
      playingMusicId.value = null
    }
    el.onerror = () => {
      playingMusicId.value = null
    }
    await el.play()
  }
  catch (e) {
    console.error('[scene] playMusic failed:', e)
    playingMusicId.value = null
  }
}

function stopMusic() {
  musicAudioEl.pause()
  musicAudioEl.removeAttribute('src')
  musicAudioEl.load()
  playingMusicId.value = null
  const sess = captureSessions.get('music')
  if (sess) {
    sess.stop()
    captureSessions.delete('music')
  }
  if (guildId.value)
    stopAudioStream(guildId.value).catch(() => {})
}

function stopMusicLocal() {
  musicAudioEl.pause()
  musicAudioEl.removeAttribute('src')
  musicAudioEl.load()
  playingMusicId.value = null
}

function playEffectLocal(item: SceneItem) {
  const el = effectAudioEl
  el.src = soundStreamUrl('effects', item.soundId)
  el.volume = (item.volume ?? 80) / 100 * (globalVolume.value / 100)
  el.load()
  el.play().catch(e => console.error('[scene] playEffectLocal failed:', e))
}

async function playEffect(item: SceneItem) {
  if (!guildId.value || !isJoined.value)
    return
  try {
    const el = effectAudioEl
    const streamId = `effect-${item.soundId}`
    await startEffectStream(guildId.value, streamId)
    el.src = soundStreamUrl('effects', item.soundId)
    el.volume = (item.volume ?? 80) / 100 * (globalVolume.value / 100)
    el.load()
    await new Promise<void>((resolve, reject) => {
      el.addEventListener('canplaythrough', () => resolve(), { once: true })
      el.addEventListener('error', () => reject(el.error ?? new Error('Audio load failed')), { once: true })
    })
    const onChunk = (chunk: ArrayBuffer) => sendEffectChunk(guildId.value!, chunk, streamId)
    const sess = await captureFromAudioElement(el, onChunk)
    captureSessions.set('effect', sess)
    el.onended = () => {
      stopEffectStream(guildId.value!, streamId).catch(() => {})
      captureSessions.delete('effect')
    }
    await el.play()
  }
  catch (e) {
    console.error('[scene] playEffect failed:', e)
  }
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
  await saveScene(scene.value).catch(() => {})
}

async function removeFromScene(category: 'ambience' | 'music' | 'effects', soundId: string) {
  if (!scene.value)
    return
  const list = scene.value[category]
  const idx = list.findIndex((i: SceneItem) => i.soundId === soundId)
  if (idx >= 0) {
    list.splice(idx, 1)
    if (category === 'ambience')
      stopAmbience(soundId)
    await saveScene(scene.value).catch(() => {})
  }
}

async function playSceneLocal() {
  if (!scene.value)
    return
  stopScene()
  scenePlayingLocal.value = true
  try {
    for (const item of scene.value.ambience.filter(a => a.enabled))
      await playAmbienceLocal(item)
    const firstMusic = scene.value.music[0]
    if (firstMusic) {
      stopMusicLocal()
      const el = musicAudioEl
      playingMusicId.value = firstMusic.soundId
      el.src = soundStreamUrl('music', firstMusic.soundId)
      el.loop = firstMusic.loop ?? false
      el.volume = (firstMusic.volume ?? 80) / 100 * (globalVolume.value / 100)
      el.load()
      await new Promise<void>((resolve, reject) => {
        el.addEventListener('canplaythrough', () => resolve(), { once: true })
        el.addEventListener('error', () => reject(el.error ?? new Error('Audio load failed')), { once: true })
      })
      el.onended = () => {
        playingMusicId.value = null
      }
      el.onerror = () => {
        playingMusicId.value = null
      }
      await el.play()
    }
  }
  catch (e) {
    console.error('[scene] playSceneLocal failed:', e)
    stopSceneLocal()
  }
}

function stopSceneLocal() {
  for (const item of scene.value?.ambience ?? [])
    stopAmbienceLocal(item.soundId)
  stopMusicLocal()
  scenePlayingLocal.value = false
}

async function playScene() {
  if (!scene.value || !isJoined.value || !guildId.value)
    return
  stopSceneLocal()
  player.scenePlaying = true
  try {
    for (const item of scene.value.ambience.filter(a => a.enabled))
      await playAmbience(item)
    const firstMusic = scene.value.music[0]
    if (firstMusic)
      await playMusic(firstMusic)
  }
  catch (e) {
    console.error('[scene] playScene failed:', e)
  }
}

function stopScene() {
  for (const item of scene.value?.ambience ?? [])
    stopAmbience(item.soundId)
  stopMusic()
  player.scenePlaying = false
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
  if (!name)
    return
  createSceneBusy.value = true
  exportImportMessage.value = null
  try {
    const newScene = await saveScene({ name, ambience: [], music: [], effects: [] })
    scenes.value = await listScenes()
    showCreateInput.value = false
    newSceneName.value = ''
    await router.push(`/scenes/${newScene.id}`)
  }
  catch (err) {
    exportImportMessage.value = { type: 'error', text: err instanceof Error ? err.message : 'Couldn\'t create the scene. Try again.' }
  }
  finally {
    createSceneBusy.value = false
  }
}

async function deleteCurrentScene() {
  // eslint-disable-next-line no-alert -- simple confirm for destructive action
  if (!scene.value || !confirm(`Delete "${scene.value.name}"? This can't be undone.`))
    return
  stopScene()
  stopSceneLocal()
  await deleteScene(scene.value.id)
  scenes.value = await listScenes()
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
    filters: [{ name: 'Zip Archives', extensions: ['zip'] }],
  })
  if (!targetPath)
    return
  exportBusy.value = true
  try {
    await exportScene(scene.value.id, targetPath)
    exportImportMessage.value = { type: 'success', text: `Exported to ${targetPath}` }
  }
  catch (e) {
    exportImportMessage.value = { type: 'error', text: e instanceof Error ? e.message : 'Export failed. Check that the folder is writable and try again.' }
  }
  finally {
    exportBusy.value = false
  }
}

async function doImportScene() {
  exportImportMessage.value = null
  const sourcePath = await openFileDialog({
    title: 'Import scene from zip',
    filters: [{ name: 'Zip Archives', extensions: ['zip'] }],
  })
  if (!sourcePath)
    return
  importBusy.value = true
  try {
    const imported = await importScene(sourcePath)
    scenes.value = await listScenes()
    await router.push(`/scenes/${imported.id}`)
    exportImportMessage.value = { type: 'success', text: `Imported "${imported.name}"` }
  }
  catch (e) {
    exportImportMessage.value = { type: 'error', text: e instanceof Error ? e.message : 'Import failed. Make sure the file is a valid Hibiki scene (.zip) and try again.' }
  }
  finally {
    importBusy.value = false
  }
}

function isSoundMissing(category: 'ambience' | 'music' | 'effects', soundId: string): boolean {
  const list = category === 'ambience' ? ambienceSounds.value : category === 'music' ? musicSounds.value : effectsSounds.value
  return !list.some(s => s.id === soundId)
}

async function relinkSound(category: 'ambience' | 'music' | 'effects', item: SceneItem, soundId: string, soundName: string) {
  if (!scene.value)
    return
  item.soundId = soundId
  item.soundName = soundName
  await Promise.all([
    saveScene(scene.value).catch(() => {}),
    loadSounds(),
  ])
}

async function onRegistryInstalled(sceneId: string) {
  scenes.value = await listScenes()
  showRegistryBrowser.value = false
  await router.push(`/scenes/${sceneId}`)
}

onMounted(() => {
  loadScenes()
  loadSounds()
})

onActivated(() => {
  loadScenes()
  loadSounds()
  loadScene()
})

watch(sceneId, (newId, oldId) => {
  const hadScene = oldId !== undefined && oldId !== ''
  const hasNoScene = newId === undefined || newId === ''
  if (hadScene && (hasNoScene || newId !== oldId)) {
    stopScene()
    stopSceneLocal()
  }
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

      <!-- Scene list -->
      <ul v-if="scenes.length > 0" class="scene-list">
        <li v-for="s in scenes" :key="s.id">
          <RouterLink :to="`/scenes/${s.id}`" class="scene-list-item">
            <span class="scene-list-name">{{ s.name }}</span>
            <span class="scene-list-counts">
              <span v-if="s.music.length" class="count-badge count-badge-music">{{ s.music.length }} music</span>
              <span v-if="s.ambience.length" class="count-badge count-badge-ambience">{{ s.ambience.length }} ambience</span>
              <span v-if="s.effects.length" class="count-badge count-badge-effects">{{ s.effects.length }} effects</span>
              <span v-if="sceneSoundCount(s) === 0" class="count-badge count-badge-empty">empty</span>
            </span>
            <span v-if="s.updatedAt" class="scene-list-date">{{ formatDate(s.updatedAt) }}</span>
            <span class="scene-list-arrow" aria-hidden="true">›</span>
          </RouterLink>
        </li>
      </ul>

      <!-- Empty state: no scenes at all -->
      <div v-else class="scene-empty">
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
            {{ scene?.name ?? 'Loading…' }}
          </h1>
          <div v-if="scene" class="detail-actions">
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

      <div v-if="scene" class="scene-playback-bar">
        <label class="global-volume">
          <span class="volume-icon" aria-hidden="true">🔊</span>
          <input
            v-model.number="globalVolume"
            type="range"
            min="0"
            max="100"
            class="volume-slider"
            aria-label="Global volume"
          >
        </label>
        <div class="playback-actions">
          <template v-if="scenePlayingLocal || player.scenePlaying">
            <button
              type="button"
              class="btn btn-stop-scene"
              @click="scenePlayingLocal ? stopSceneLocal() : stopScene()"
            >
              Stop
            </button>
          </template>
          <template v-else>
            <button
              type="button"
              class="btn btn-ghost btn-play-local"
              :title="hasAnySoundMissing ? 'Some sounds are missing — add them to your library first' : 'Play in this app only (no Discord)'"
              :disabled="hasAnySoundMissing"
              @click="playSceneLocal"
            >
              Play
            </button>
            <button
              type="button"
              class="btn btn-primary btn-play-scene"
              :title="hasAnySoundMissing ? 'Some sounds are missing — add them to your library first' : 'Stream this scene to your Discord voice channel'"
              :disabled="!isJoined || hasAnySoundMissing"
              @click="playScene"
            >
              Stream
            </button>
          </template>
        </div>
      </div>

      <template v-if="scene">
        <section class="scene-section scene-section-ambience">
          <div class="section-header">
            <h2 class="section-title">
              Ambience
            </h2>
            <select
              class="add-select"
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
                    @input="updateAmbienceVolume(item)"
                    @change="saveScene(scene)"
                  >
                  <label class="toggle">
                    <input
                      v-model="item.enabled"
                      type="checkbox"
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
            <select
              class="add-select"
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
              :class="{ 'sound-card-has-hint': isSoundMissing('music', item.soundId) }"
            >
              <div class="sound-card-main-row">
                <div class="sound-card-info">
                  <span class="sound-name">{{ item.soundName ?? resolveSoundName('music', item.soundId) }}</span>
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
                    @click="stopMusic"
                  >
                    ■
                  </button>
                  <button
                    v-else
                    type="button"
                    class="btn-icon"
                    :disabled="!isJoined || isSoundMissing('music', item.soundId)"
                    title="Play"
                    :aria-label="`Play ${item.soundName ?? resolveSoundName('music', item.soundId)}`"
                    @click="playMusic(item)"
                  >
                    ▶
                  </button>
                  <input
                    v-model.number="item.volume"
                    type="range"
                    min="0"
                    max="100"
                    class="volume-slider"
                    @input="updateMusicVolume(item)"
                    @change="saveScene(scene)"
                  >
                  <label class="toggle" title="Loop">
                    <input v-model="item.loop" type="checkbox" @change="saveScene(scene)">
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
              v-for="item in scene.effects"
              :key="item.soundId"
              class="effect-card"
              :class="{ 'effect-card-missing': isSoundMissing('effects', item.soundId) }"
            >
              <button
                type="button"
                class="effect-trigger"
                :disabled="isSoundMissing('effects', item.soundId)"
                :title="isSoundMissing('effects', item.soundId) ? 'Sound missing' : `Play ${item.soundName ?? resolveSoundName('effects', item.soundId)}`"
                @click="isJoined ? playEffect(item) : playEffectLocal(item)"
              >
                <span class="effect-name">{{ item.soundName ?? resolveSoundName('effects', item.soundId) }}</span>
                <span v-if="isSoundMissing('effects', item.soundId)" class="sound-missing-badge">
                  missing
                </span>
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

.scene-list-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 0.75rem;
  border-radius: var(--radius-sm);
  text-decoration: none;
  color: var(--color-text);
  transition: background var(--transition);
}

.scene-list-item:hover {
  background: var(--color-bg-card);
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
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.effect-trigger {
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

.effect-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.effect-remove {
  position: absolute;
  top: 0.35rem;
  right: 0.25rem;
  width: 1.5rem;
  height: 1.5rem;
  font-size: 1rem;
  background: transparent;
  opacity: 0;
  transition: opacity 0.15s;
}

.effect-card:hover .effect-remove {
  opacity: 1;
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
