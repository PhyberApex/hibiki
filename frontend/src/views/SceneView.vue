<script setup lang="ts">
import type { Scene, SceneItem } from '@/api/scenes'
import type { SoundFile } from '@/api/sounds'
import type { CaptureSession } from '@/audio/browser-audio-capture'
import { computed, onActivated, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
const showCreateInput = ref(false)
const newSceneName = ref('')
const createSceneBusy = ref(false)
const exportBusy = ref(false)
const importBusy = ref(false)
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
  scenes.value = await listScenes()
}

async function loadScene() {
  if (sceneId.value === undefined || !sceneId.value) {
    scene.value = null
    return
  }
  scene.value = await getScene(sceneId.value)
}

async function loadSounds() {
  const [ambience, music, effects] = await Promise.all([
    listAmbience(),
    listMusic(),
    listEffects(),
  ])
  ambienceSounds.value = ambience
  musicSounds.value = music
  effectsSounds.value = effects
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

async function playScene() {
  if (!scene.value || !isJoined.value || !guildId.value)
    return
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
  try {
    const newScene = await saveScene({ name, ambience: [], music: [], effects: [] })
    scenes.value = await listScenes()
    showCreateInput.value = false
    newSceneName.value = ''
    await router.push(`/scenes/${newScene.id}`)
  }
  catch (err) {
    console.error('[scene] Failed to create scene:', err)
  }
  finally {
    createSceneBusy.value = false
  }
}

async function deleteCurrentScene() {
  // eslint-disable-next-line no-alert -- simple confirm for delete
  if (!scene.value || !confirm(`Delete "${scene.value.name}"?`))
    return
  stopScene()
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
    exportImportMessage.value = { type: 'error', text: e instanceof Error ? e.message : 'Export failed' }
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
    exportImportMessage.value = { type: 'error', text: e instanceof Error ? e.message : 'Import failed' }
  }
  finally {
    importBusy.value = false
  }
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
  if (hadScene && (hasNoScene || newId !== oldId))
    stopScene()
  loadScene()
}, { immediate: true })
</script>

<template>
  <main class="scene-view">
    <header class="scene-header">
      <div class="scene-title-row">
        <select
          :value="sceneId ?? ''"
          class="scene-select"
          @change="(e) => router.push((e.target as HTMLSelectElement).value ? `/scenes/${(e.target as HTMLSelectElement).value}` : '/scenes')"
        >
          <option value="">
            Select a scene…
          </option>
          <option v-for="s in scenes" :key="s.id" :value="s.id">
            {{ s.name }}
          </option>
        </select>
        <div class="scene-actions">
          <button type="button" class="btn btn-ghost" @click="openCreateScene">
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
          <button
            v-if="scene"
            type="button"
            class="btn btn-ghost"
            :disabled="exportBusy"
            @click="doExportScene"
          >
            {{ exportBusy ? 'Exporting…' : 'Export' }}
          </button>
          <button
            v-if="scene"
            type="button"
            class="btn btn-ghost btn-danger"
            @click="deleteCurrentScene"
          >
            Delete
          </button>
        </div>
      </div>
      <div v-if="showCreateInput && scenes.length > 0" class="create-scene-form create-scene-form-inline create-scene-form-card">
        <input
          v-model="newSceneName"
          type="text"
          class="create-scene-input"
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
      <p v-if="exportImportMessage" class="export-import-message" :class="[exportImportMessage.type]">
        {{ exportImportMessage.text }}
      </p>
      <div v-else-if="scene" class="scene-controls">
        <label class="global-volume">
          <span class="volume-icon" aria-hidden="true">🔊</span>
          <input
            v-model.number="globalVolume"
            type="range"
            min="0"
            max="100"
            class="volume-slider"
          >
        </label>
        <button
          v-if="player.scenePlaying"
          type="button"
          class="btn btn-stop-scene"
          @click="stopScene"
        >
          Stop scene
        </button>
        <button
          v-else
          type="button"
          class="btn btn-primary btn-play-scene"
          :disabled="!isJoined"
          @click="playScene"
        >
          Play scene
        </button>
      </div>
    </header>

    <div v-if="!scene && scenes.length === 0" class="scene-empty">
      <p>No scenes yet. Create one to get started.</p>
      <div v-if="showCreateInput" class="create-scene-form create-scene-form-inline create-scene-form-card">
        <input
          v-model="newSceneName"
          type="text"
          class="create-scene-input"
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
      <button v-else type="button" class="btn btn-primary" @click="openCreateScene">
        Create scene
      </button>
    </div>

    <div v-else-if="!scene && scenes.length > 0" class="scene-empty scene-empty-select">
      <p>Select a scene from the dropdown above to edit it, or create a new one.</p>
      <div v-if="showCreateInput" class="create-scene-form create-scene-form-inline create-scene-form-card">
        <input
          v-model="newSceneName"
          type="text"
          class="create-scene-input"
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
      <button v-else type="button" class="btn btn-primary" @click="openCreateScene">
        New scene
      </button>
    </div>

    <template v-if="scene">
      <section class="scene-section">
        <h2 class="section-title">
          Ambience
        </h2>
        <div class="add-sounds">
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
                    @change="toggleAmbience(item)"
                  >
                </label>
                <button
                  type="button"
                  class="btn-icon btn-remove"
                  title="Remove"
                  @click="removeFromScene('ambience', item.soundId)"
                >
                  ×
                </button>
              </div>
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
          Add ambience from the media library.
        </p>
      </section>

      <section class="scene-section">
        <h2 class="section-title">
          Music
        </h2>
        <div class="add-sounds">
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
          >
            <div class="sound-card-info">
              <span class="sound-name">{{ item.soundName ?? resolveSoundName('music', item.soundId) }}</span>
            </div>
            <div class="sound-card-controls sound-card-controls-music">
              <button
                v-if="playingMusicId === item.soundId"
                type="button"
                class="btn-icon btn-icon-active"
                title="Stop"
                @click="stopMusic"
              >
                ■
              </button>
              <button
                v-else
                type="button"
                class="btn-icon"
                :disabled="!isJoined"
                title="Play"
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
                @click="removeFromScene('music', item.soundId)"
              >
                ×
              </button>
            </div>
          </div>
        </div>
        <p v-if="scene.music.length === 0" class="section-empty">
          Add music from the media library.
        </p>
      </section>

      <section class="scene-section">
        <h2 class="section-title">
          Effects
        </h2>
        <div class="add-sounds">
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
        <div class="sound-cards">
          <div
            v-for="item in scene.effects"
            :key="item.soundId"
            class="sound-card"
          >
            <div class="sound-card-info">
              <span class="sound-name">{{ item.soundName ?? resolveSoundName('effects', item.soundId) }}</span>
            </div>
            <div class="sound-card-controls">
              <button
                type="button"
                class="btn btn-play"
                :disabled="!isJoined"
                @click="playEffect(item)"
              >
                Play
              </button>
              <button
                type="button"
                class="btn-icon btn-remove"
                title="Remove"
                @click="removeFromScene('effects', item.soundId)"
              >
                ×
              </button>
            </div>
          </div>
        </div>
        <p v-if="scene.effects.length === 0" class="section-empty">
          Add effects from the media library.
        </p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.scene-view {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  max-width: 900px;
}

.export-import-message {
  margin: 0;
  font-size: 0.875rem;
}
.export-import-message.success {
  color: var(--color-success, green);
}
.export-import-message.error {
  color: var(--color-error, #c00);
}
.scene-header {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.scene-title-row {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.scene-select {
  flex: 1;
  min-width: 0;
  padding: 0.5rem 0.75rem;
  font-size: 1.1rem;
  font-weight: 600;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
}

.scene-actions {
  display: flex;
  gap: 0.5rem;
}

.scene-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
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

.btn-play-scene {
  padding: 0.5rem 1.5rem;
  font-size: 1rem;
}

.btn-stop-scene {
  padding: 0.5rem 1.5rem;
  font-size: 1rem;
  background: var(--color-error-muted, rgba(220, 38, 38, 0.15));
  color: var(--color-error, #dc2626);
  border: 1px solid var(--color-error, #dc2626);
  border-radius: var(--radius-md);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.btn-stop-scene:hover {
  background: var(--color-error, #dc2626);
  color: #fff;
}

.scene-empty {
  text-align: center;
  padding: 3rem 2rem;
  background: var(--color-bg-card);
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
}

/* Create scene form – matches scene-select and add-select */
.create-scene-form {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 1rem;
  align-items: center;
}

.create-scene-form-inline {
  margin-top: 0;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.create-scene-form-card {
  padding: 0.75rem 1rem;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.create-scene-input {
  padding: 0.5rem 0.75rem;
  font-size: 0.95rem;
  font-weight: 500;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  min-width: 200px;
  transition: border-color var(--transition);
}

.create-scene-input::placeholder {
  color: var(--color-text-dim);
}

.create-scene-input:focus {
  outline: none;
  border-color: var(--color-border-focus);
}

.create-scene-buttons {
  display: flex;
  gap: 0.5rem;
}

/* Button styles */
.btn {
  border: none;
  border-radius: var(--radius-md);
  padding: 0.5rem 1rem;
  font-size: 0.9rem;
  font-weight: 500;
  transition: background var(--transition), color var(--transition), border-color var(--transition), opacity var(--transition);
}

.btn-primary {
  background: var(--color-accent);
  color: #0c0c0e;
}

.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-ghost {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}

.btn-ghost:hover:not(:disabled) {
  background: var(--color-bg-elevated);
  color: var(--color-text);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.scene-section {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1.25rem;
}

.section-desc {
  margin: 0 0 1rem;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.section-title {
  margin: 0 0 1rem;
  font-size: 0.9rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-dim);
}

.sound-cards {
  display: grid;
  gap: 0.75rem;
}

.sound-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.sound-card-ambience {
  flex-direction: column;
  align-items: stretch;
  gap: 0.5rem;
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
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.repeat-label {
  white-space: nowrap;
}

.repeat-select {
  padding: 0.2rem 0.4rem;
  font-size: 0.8rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
}

.sound-card-info {
  min-width: 0;
}

.sound-name {
  font-weight: 500;
  color: var(--color-text);
}

.sound-card-controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}

.sound-card-controls-music {
  gap: 0.5rem;
}

.btn-icon {
  width: 2rem;
  height: 2rem;
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
  background: var(--color-error-muted, rgba(220, 38, 38, 0.15));
  color: var(--color-error, #dc2626);
}

.btn-icon-active:hover {
  background: var(--color-error, #dc2626);
  color: #fff;
}

.btn-play {
  padding: 0.35rem 0.75rem;
  font-size: 0.85rem;
}

.toggle input {
  accent-color: var(--color-accent);
}

.add-sounds {
  margin-bottom: 0.75rem;
}

.add-select {
  padding: 0.35rem 0.6rem;
  font-size: 0.85rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
}

.btn-remove {
  color: var(--color-text-muted);
  font-size: 1.2rem;
  line-height: 1;
}

.btn-remove:hover {
  color: var(--color-error);
}

.section-empty {
  margin: 0;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}

.btn-danger:hover {
  color: var(--color-error);
}
</style>
