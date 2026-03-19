<script setup lang="ts">
import type { SoundFile } from '@/api/sounds'
import { computed, nextTick, onActivated, onMounted, ref } from 'vue'
import {
  deleteSound,
  listAmbience,
  listEffects,
  listMusic,
  soundStreamUrl,
  uploadSound,
  uploadSoundsBulk,
} from '@/api/sounds'

const props = defineProps<{ type: 'music' | 'effects' | 'ambience' }>()
const emit = defineEmits<{ updated: [] }>()

const categoryHint: Record<string, string> = {
  music: 'Background tracks that play one at a time — tavern themes, battle scores, travel music.',
  ambience: 'Loops that layer together — rain, wind, crackling fire, crowd chatter.',
  effects: 'One-shot sounds you trigger on demand — thunder, door slam, sword clash.',
}

const items = ref<SoundFile[]>([])
const searchQuery = ref('')
const sortBy = ref<'name' | 'date'>('name')
const loading = ref(true)
const error = ref<string | null>(null)
const uploading = ref(false)
const uploadProgress = ref<string | null>(null)
const pendingDeleteId = ref<string | null>(null)
const playingId = ref<string | null>(null)
const dragOver = ref(false)
const audioEl = ref<HTMLAudioElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const toast = ref<{ type: 'success' | 'error', text: string } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(type: 'success' | 'error', text: string) {
  if (toastTimer)
    clearTimeout(toastTimer)
  toast.value = { type, text }
  toastTimer = setTimeout(() => {
    toast.value = null
    toastTimer = null
  }, 4000)
}

function fileExt(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toUpperCase() : ''
}

function formatSize(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  if (d.getFullYear() === now.getFullYear())
    return `${months[d.getMonth()]} ${d.getDate()}`
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

async function loadSounds() {
  loading.value = true
  error.value = null
  try {
    items.value = props.type === 'music'
      ? await listMusic()
      : props.type === 'ambience'
        ? await listAmbience()
        : await listEffects()
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : 'Couldn\'t load sounds. Try switching tabs and coming back.'
  }
  finally {
    loading.value = false
  }
}

const filteredItems = computed(() => {
  let list = [...items.value]
  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    list = list.filter(s => s.name.toLowerCase().includes(q))
  }
  if (sortBy.value === 'name')
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  else
    list.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  return list
})

async function handleFiles(files: FileList | File[] | null) {
  const fileArray = files
    ? (Array.isArray(files) ? files : Array.from(files))
    : []
  if (fileArray.length === 0)
    return
  if (fileArray.length === 1) {
    const file = fileArray[0]!
    uploading.value = true
    uploadProgress.value = null
    try {
      await uploadSound(props.type, file)
      await loadSounds()
      emit('updated')
      showToast('success', `Added to ${props.type}.`)
    }
    catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed. Check that the file is a supported audio format and try again.'
      error.value = msg
      showToast('error', msg)
    }
    finally {
      uploading.value = false
    }
    return
  }
  uploading.value = true
  uploadProgress.value = `Uploading ${fileArray.length} files…`
  try {
    const { success, failed } = await uploadSoundsBulk(props.type, fileArray)
    await loadSounds()
    emit('updated')
    if (failed.length === 0)
      showToast('success', `Added ${success.length} ${success.length === 1 ? 'file' : 'files'} to ${props.type}.`)
    else if (success.length > 0)
      showToast('success', `Added ${success.length} ${success.length === 1 ? 'file' : 'files'}, but ${failed.length} couldn't be uploaded. Check that all files are audio.`)
    else
      showToast('error', `None of the ${failed.length} files could be uploaded. Make sure they're audio files (MP3, WAV, OGG, etc).`)
  }
  catch (err) {
    showToast('error', err instanceof Error ? err.message : 'Upload failed. Check that the files are supported audio formats and try again.')
  }
  finally {
    uploading.value = false
    uploadProgress.value = null
  }
}

function handleUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const fileList = input.files
  if (!fileList?.length)
    return
  handleFiles(Array.from(fileList))
  input.value = ''
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragOver.value = false
  const files = e.dataTransfer?.files
  if (files?.length)
    handleFiles(files)
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  e.dataTransfer && (e.dataTransfer.dropEffect = 'copy')
  dragOver.value = true
}

function onDragLeave() {
  dragOver.value = false
}

function askDelete(id: string) {
  pendingDeleteId.value = id
}

function cancelDelete() {
  pendingDeleteId.value = null
}

function stop() {
  const el = audioEl.value
  if (el) {
    el.pause()
    el.removeAttribute('src')
  }
  playingId.value = null
}

async function togglePlay(id: string) {
  if (playingId.value === id) {
    stop()
    return
  }
  playingId.value = id
  await nextTick()
  const el = audioEl.value
  if (el) {
    el.src = soundStreamUrl(props.type, id)
    el.load()
    el.play().catch(() => {
      stop()
    })
  }
}

function onAudioEnded() {
  playingId.value = null
}

async function confirmDelete(id: string) {
  if (pendingDeleteId.value !== id)
    return
  pendingDeleteId.value = null
  try {
    await deleteSound(props.type, id)
    await loadSounds()
    emit('updated')
    showToast('success', 'Removed from library.')
  }
  catch (err) {
    showToast('error', err instanceof Error ? err.message : 'Couldn\'t delete. The file may be in use — try again in a moment.')
  }
}

onMounted(() => {
  loadSounds()
})

onActivated(() => {
  loadSounds()
})
</script>

<template>
  <section
    class="panel"
    :class="{ 'panel-drop-active': dragOver }"
    @drop="onDrop"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
  >
    <header class="panel-toolbar">
      <div class="panel-actions">
        <input
          v-if="items.length > 0"
          v-model="searchQuery"
          type="text"
          class="search-input input"
          :placeholder="`Search ${type}…`"
        >
        <select v-if="items.length > 1" v-model="sortBy" class="sort-select">
          <option value="name">
            A–Z
          </option>
          <option value="date">
            Newest
          </option>
        </select>
        <input
          ref="fileInputRef"
          type="file"
          accept="audio/*"
          multiple
          class="sr-only"
          :disabled="uploading"
          @change="handleUpload"
        >
        <button
          type="button"
          class="btn-upload"
          :disabled="uploading"
          @click="fileInputRef?.click()"
        >
          {{ uploading ? (uploadProgress ?? 'Uploading…') : '+ Add' }}
        </button>
      </div>
    </header>

    <p v-if="toast" class="toast" :class="[`toast-${toast.type}`]">
      {{ toast.text }}
    </p>

    <audio ref="audioEl" class="sr-only" @ended="onAudioEnded" />

    <p v-if="loading" class="empty-state">
      Loading…
    </p>
    <p v-else-if="error" class="empty-state empty-state-error">
      {{ error }}
    </p>
    <div v-else-if="items.length === 0" class="empty-state empty-state-drop">
      <p class="empty-category-hint">
        {{ categoryHint[type] }}
      </p>
      <p class="empty-action-hint">
        Drag audio files here or click <strong>+ Add</strong> above.
      </p>
    </div>
    <div v-else-if="filteredItems.length === 0" class="empty-state">
      No matches for "{{ searchQuery }}"
    </div>

    <ul v-else class="sound-list">
      <li
        v-for="sound in filteredItems"
        :key="sound.id"
        class="sound-item"
        :class="{ 'sound-item-playing': playingId === sound.id }"
      >
        <button
          type="button"
          class="sound-play-btn"
          :title="playingId === sound.id ? 'Stop' : `Play ${sound.name}`"
          @click="togglePlay(sound.id)"
        >
          <span v-if="playingId === sound.id" class="icon-stop">■</span>
          <span v-else class="icon-play">▶</span>
        </button>

        <span class="sound-name" :title="sound.name">{{ sound.name }}</span>

        <span class="sound-ext">{{ fileExt(sound.filename) }}</span>
        <span v-if="sound.size" class="sound-meta">{{ formatSize(sound.size) }}</span>
        <span v-if="sound.createdAt" class="sound-meta sound-date">{{ formatDate(sound.createdAt) }}</span>

        <div v-if="pendingDeleteId === sound.id" class="delete-confirm">
          <button type="button" class="btn-confirm-delete" @click="confirmDelete(sound.id)">
            Delete
          </button>
          <button type="button" class="btn-cancel-delete" @click="cancelDelete">
            Cancel
          </button>
        </div>
        <button
          v-else
          type="button"
          class="btn-delete"
          :disabled="pendingDeleteId !== null"
          title="Delete"
          :aria-label="`Delete ${sound.name}`"
          @click="askDelete(sound.id)"
        >
          ×
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  transition: background var(--transition);
}

.panel-drop-active {
  background: var(--color-accent-muted);
  border-radius: var(--radius-md);
}

.panel-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
  flex-shrink: 0;
}

.panel-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  justify-content: flex-end;
}

.search-input {
  flex: 1;
  max-width: 240px;
  padding: 0.3rem 0.6rem;
  font-size: 0.8rem;
}

.sort-select {
  padding: 0.25rem 0.4rem;
  font-size: 0.75rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
}

.btn-upload {
  padding: 0.3rem 0.6rem;
  font-size: 0.8rem;
  font-weight: 500;
  background: var(--color-accent);
  color: var(--color-accent-text);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition);
  white-space: nowrap;
}

.btn-upload:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-upload:disabled {
  opacity: 0.6;
  cursor: wait;
}

.toast {
  margin: 0 0 0.5rem;
  padding: 0.35rem 0.6rem;
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  font-weight: 500;
  flex-shrink: 0;
  animation: toast-in 0.25s ease-out;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.toast-success {
  background: var(--color-success-muted);
  color: var(--color-success);
}

.toast-error {
  background: var(--color-error-muted);
  color: var(--color-error);
}

.empty-state {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--color-text-muted);
  font-size: 0.85rem;
}

.empty-state p {
  margin: 0;
}

.empty-state-error {
  color: var(--color-error);
}

.empty-state-drop {
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  padding: 2.5rem 1.5rem;
}

.empty-category-hint {
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.empty-action-hint {
  margin-top: 0.75rem;
  font-size: 0.8rem;
  color: var(--color-text-dim);
}

.empty-action-hint strong {
  color: var(--color-text-muted);
  font-weight: 600;
}

/* ── Sound list ── */

.sound-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.sound-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  border-radius: var(--radius-sm);
  transition: background var(--transition);
}

.sound-item:hover {
  background: var(--color-bg-card);
}

.sound-item-playing {
  background: var(--color-accent-muted);
  box-shadow: inset 3px 0 0 var(--color-accent);
}

.sound-play-btn {
  width: 1.5rem;
  height: 1.5rem;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  font-size: 0.65rem;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.sound-play-btn:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text);
}

.sound-item-playing .sound-play-btn {
  color: var(--color-accent);
}

.icon-play,
.icon-stop {
  line-height: 1;
}

.sound-name {
  flex: 1;
  min-width: 0;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sound-ext {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.1rem 0.3rem;
  border-radius: var(--radius-sm);
  background: var(--color-bg-elevated);
  color: var(--color-text-dim);
  flex-shrink: 0;
}

.sound-meta {
  font-size: 0.75rem;
  color: var(--color-text-dim);
  flex-shrink: 0;
  white-space: nowrap;
}

.btn-delete {
  width: 1.35rem;
  height: 1.35rem;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-dim);
  font-size: 0.9rem;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--transition), color var(--transition), background var(--transition);
}

.sound-item:hover .btn-delete,
.sound-item:focus-within .btn-delete,
.btn-delete:focus-visible {
  opacity: 1;
}

.btn-delete:hover:not(:disabled) {
  color: var(--color-error);
  background: var(--color-error-muted);
}

.btn-delete:disabled {
  opacity: 0.2;
  cursor: not-allowed;
}

.delete-confirm {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.btn-confirm-delete {
  padding: 0.2rem 0.45rem;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--color-error-muted);
  color: var(--color-error);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.btn-confirm-delete:hover {
  background: var(--color-error);
  color: var(--color-on-accent-bg);
}

.btn-cancel-delete {
  padding: 0.2rem 0.45rem;
  font-size: 0.75rem;
  font-weight: 500;
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.btn-cancel-delete:hover {
  background: var(--color-border);
  color: var(--color-text);
}

/* ── Narrow ── */

@media (max-width: 560px) {
  .panel-toolbar {
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .panel-actions {
    flex-basis: 100%;
  }

  .search-input {
    max-width: none;
  }

  .sound-meta {
    display: none;
  }

  .empty-state-drop {
    padding: 1.5rem 1rem;
  }
}
</style>
