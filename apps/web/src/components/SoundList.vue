<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { SoundFile } from '@/api/sounds'
import {
  deleteSound,
  listEffects,
  listEffectsTags,
  listMusic,
  listMusicTags,
  setSoundTags,
  soundStreamUrl,
  uploadSound,
} from '@/api/sounds'

const props = defineProps<{ title: string; type: 'music' | 'effects' }>()
const emit = defineEmits<{ uploaded: [] }>()

const items = ref<SoundFile[]>([])
const availableTags = ref<string[]>([])
const selectedTag = ref('')
const sortBy = ref<'name' | 'date' | 'tags'>('name')
const loading = ref(true)
const error = ref<string | null>(null)
const uploading = ref(false)
const pendingDeleteId = ref<string | null>(null)
const editingTagsId = ref<string | null>(null)
const editingTagsDraft = ref<string[]>([])
const editingTagInput = ref('')
const playingId = ref<string | null>(null)
const dragOver = ref(false)
const audioEl = ref<HTMLAudioElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const toast = ref<{ type: 'success' | 'error'; text: string } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(type: 'success' | 'error', text: string) {
  if (toastTimer) clearTimeout(toastTimer)
  toast.value = { type, text }
  toastTimer = setTimeout(() => {
    toast.value = null
    toastTimer = null
  }, 4000)
}

async function loadTags() {
  try {
    availableTags.value =
      props.type === 'music' ? await listMusicTags() : await listEffectsTags()
  } catch {
    availableTags.value = []
  }
}

async function loadSounds() {
  loading.value = true
  error.value = null
  try {
    const tag = selectedTag.value || undefined
    items.value =
      props.type === 'music' ? await listMusic(tag) : await listEffects(tag)
    await loadTags()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unknown error'
  } finally {
    loading.value = false
  }
}

const sortedItems = computed(() => {
  const list = [...items.value]
  if (sortBy.value === 'name') {
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  } else if (sortBy.value === 'date') {
    list.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  } else {
    list.sort((a, b) => {
      const ta = (a.tags?.[0] ?? '').toLowerCase()
      const tb = (b.tags?.[0] ?? '').toLowerCase()
      if (ta !== tb) return ta.localeCompare(tb)
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
  }
  return list
})

function startEditingTags(sound: SoundFile) {
  editingTagsId.value = sound.id
  editingTagsDraft.value = [...(sound.tags ?? [])]
  editingTagInput.value = ''
}

function cancelEditingTags() {
  editingTagsId.value = null
}

async function saveTags(soundId: string) {
  if (editingTagsId.value !== soundId) return
  const tagsToSave = [...editingTagsDraft.value]
  try {
    const res = await setSoundTags(props.type, soundId, tagsToSave)
    const sound = items.value.find((s) => s.id === soundId)
    if (sound) sound.tags = res.tags
    editingTagsId.value = null
    showToast('success', 'Tags updated.')
  } catch (err) {
    showToast('error', err instanceof Error ? err.message : 'Failed to save tags')
  }
}

function addTagToDraft(tag: string) {
  const t = tag.trim().toLowerCase()
  if (t && !editingTagsDraft.value.includes(t)) editingTagsDraft.value.push(t)
}

function removeTagFromDraft(tag: string) {
  editingTagsDraft.value = editingTagsDraft.value.filter((t) => t !== tag)
}

function addTagFromInput(e: Event) {
  const input = e.target as HTMLInputElement
  const v = input.value.trim()
  if (v) addTagToDraft(v)
  input.value = ''
  editingTagInput.value = ''
}

function addTagFromInputRef() {
  const v = editingTagInput.value.trim()
  if (v) addTagToDraft(v)
  editingTagInput.value = ''
}

async function handleFiles(files: FileList | File[] | null) {
  const file = Array.isArray(files) ? files[0] : files?.[0]
  if (!file) return
  uploading.value = true
  try {
    await uploadSound(props.type, file)
    await loadSounds()
    emit('uploaded')
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Upload failed'
  } finally {
    uploading.value = false
  }
}

function handleUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const fileList = input.files
  if (!fileList?.length) return
  const files = Array.from(fileList)
  input.value = ''
  handleFiles(files)
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragOver.value = false
  const files = e.dataTransfer?.files
  if (files?.length) handleFiles(files)
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

function playUrl(id: string) {
  return soundStreamUrl(props.type, id)
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
    el.src = playUrl(id)
    el.play().catch(() => { stop() })
  }
}

function onAudioEnded() {
  playingId.value = null
}

const playingSound = computed(() => {
  if (!playingId.value) return null
  return items.value.find((s) => s.id === playingId.value) || null
})

async function confirmDelete(id: string) {
  if (pendingDeleteId.value !== id) return
  pendingDeleteId.value = null
  try {
    await deleteSound(props.type, id)
    await loadSounds()
    emit('uploaded')
    showToast('success', 'Deleted.')
  } catch (err) {
    showToast('error', err instanceof Error ? err.message : 'Delete failed')
  }
}

watch(selectedTag, () => {
  loadSounds()
})

onMounted(() => {
  loadSounds()
})
</script>

<template>
  <section class="sound-panel">
    <header class="panel-header panel-header-upload">
      <h2 class="sound-title">{{ title }}</h2>
      <div
        class="upload-drop-zone"
        :class="{ 'upload-drop-zone-active': dragOver }"
        @drop="onDrop"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
      >
        <input
          ref="fileInputRef"
          type="file"
          accept="audio/*"
          class="upload-input-hidden"
          :disabled="uploading"
          @change="handleUpload"
        />
        <button
          type="button"
          class="btn btn-upload"
          :class="{ uploading }"
          :disabled="uploading"
          @click="fileInputRef?.click()"
        >
          {{ uploading ? 'Uploading…' : 'Upload' }}
        </button>
        <span class="upload-hint">or drop here</span>
      </div>
    </header>

    <div class="sound-filters">
      <label class="filter-row">
        <span class="filter-label">Tag</span>
        <select v-model="selectedTag" class="field-input">
          <option value="">All</option>
          <option v-for="t in availableTags" :key="t" :value="t">{{ t }}</option>
        </select>
      </label>
      <label class="filter-row">
        <span class="filter-label">Sort</span>
        <select v-model="sortBy" class="field-input">
          <option value="name">Name</option>
          <option value="date">Date</option>
          <option value="tags">Tag</option>
        </select>
      </label>
    </div>

    <p v-if="toast" :class="['sound-toast', toast.type === 'success' ? 'sound-toast-success' : 'sound-toast-error']">
      {{ toast.text }}
    </p>

    <audio ref="audioEl" class="sound-audio-hidden" @ended="onAudioEnded" />

    <div v-if="playingSound" class="sound-now-playing">
      <span class="sound-now-playing-label">Now playing:</span>
      <span class="sound-now-playing-name">{{ playingSound.name }}</span>
      <button type="button" class="btn btn-stop" @click="stop">Stop</button>
    </div>

    <p v-if="loading" class="sound-message">Loading…</p>
    <p v-else-if="error" class="sound-message sound-error">{{ error }}</p>
    <p v-else-if="items.length === 0" class="sound-message">No sounds yet.</p>

    <ul v-else class="sound-list">
      <li v-for="sound in sortedItems" :key="sound.id" class="sound-item">
        <div class="sound-info">
          <span class="sound-name">{{ sound.name }}</span>
          <span class="sound-filename">{{ sound.filename }}</span>
          <div v-if="editingTagsId === sound.id" class="sound-tags-edit">
            <span
              v-for="t in editingTagsDraft"
              :key="t"
              class="tag tag-removable"
              @click="removeTagFromDraft(t)"
            >
              {{ t }} ×
            </span>
            <input
              v-model="editingTagInput"
              type="text"
              class="tag-input"
              placeholder="Add tag…"
              @keydown.enter.prevent="addTagFromInputRef"
            />
            <button type="button" class="btn btn-ghost-sm" @click="addTagFromInputRef">Add</button>
            <button type="button" class="btn btn-ghost-sm" @click="saveTags(sound.id)">Save</button>
            <button type="button" class="btn btn-ghost-sm" @click="cancelEditingTags">Cancel</button>
          </div>
          <div v-else class="sound-tags-row">
            <span v-for="t in (sound.tags ?? [])" :key="t" class="tag">{{ t }}</span>
            <button
              type="button"
              class="btn-tag-edit"
              title="Edit tags"
              @click="startEditingTags(sound)"
            >
              {{ (sound.tags ?? []).length ? 'Edit tags' : 'Add tags' }}
            </button>
          </div>
        </div>
        <div class="sound-actions">
          <button
            v-if="playingId === sound.id"
            type="button"
            class="btn btn-stop-sm"
            @click="stop"
          >
            Stop
          </button>
          <button
            v-else
            type="button"
            class="btn btn-play"
            :disabled="pendingDeleteId !== null"
            :title="'Play ' + sound.name"
            @click="togglePlay(sound.id)"
          >
            Play
          </button>
        </div>
        <div v-if="pendingDeleteId === sound.id" class="sound-delete-confirm">
          <span class="sound-delete-label">Delete?</span>
          <button type="button" class="btn btn-danger-sm" @click="confirmDelete(sound.id)">Yes</button>
          <button type="button" class="btn btn-ghost-sm" @click="cancelDelete">Cancel</button>
        </div>
        <button
          v-else
          type="button"
          class="btn btn-danger-ghost"
          :disabled="pendingDeleteId !== null"
          @click="askDelete(sound.id)"
        >
          Delete
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.sound-panel {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  box-shadow: var(--shadow-card);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
.panel-header-upload {
  flex-wrap: wrap;
  gap: 0.5rem;
}
.upload-hint {
  font-size: 0.8rem;
  color: var(--color-text-dim);
  width: 100%;
  margin-top: -0.25rem;
}
.upload-drop-zone {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.25rem;
  padding: 0.5rem;
  margin: -0.5rem;
  border-radius: var(--radius-md);
  border: 2px dashed transparent;
  transition: border-color var(--transition), background var(--transition);
}
.upload-drop-zone-active {
  border-color: var(--color-accent);
  background: var(--color-accent-muted);
}
.upload-drop-zone .upload-hint {
  margin-top: 0;
}

.sound-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1rem;
}
.filter-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.filter-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-muted);
}
.field-input {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.35rem 0.6rem;
  font-size: 0.85rem;
  color: var(--color-text);
}
.sound-tags-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.35rem;
}
.tag {
  font-size: 0.7rem;
  padding: 0.15rem 0.45rem;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  color: var(--color-text-muted);
}
.btn-tag-edit {
  font-size: 0.7rem;
  padding: 0;
  background: none;
  border: none;
  color: var(--color-accent);
  cursor: pointer;
}
.btn-tag-edit:hover {
  text-decoration: underline;
}
.sound-tags-edit {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.35rem;
}
.tag-removable {
  cursor: pointer;
}
.tag-removable:hover {
  background: var(--color-error-muted);
  border-color: var(--color-error);
  color: var(--color-error);
}
.tag-input {
  width: 6rem;
  font-size: 0.8rem;
  padding: 0.2rem 0.4rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
}

.sound-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.btn {
  border: none;
  border-radius: var(--radius-md);
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition), opacity var(--transition);
}

.btn-upload {
  background: var(--color-accent-muted);
  color: var(--color-accent);
  border: 1px dashed var(--color-accent);
}
.btn-upload:hover:not(.uploading) {
  background: rgba(6, 182, 212, 0.25);
}
.btn-upload.uploading {
  opacity: 0.7;
  cursor: wait;
}

.btn-danger-ghost {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}
.btn-danger-ghost:hover:not(:disabled) {
  background: var(--color-error-muted);
  color: var(--color-error);
  border-color: var(--color-error);
}
.btn-danger-ghost:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-danger-sm {
  padding: 0.3rem 0.6rem;
  font-size: 0.8rem;
  background: var(--color-error-muted);
  color: var(--color-error);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-sm);
}
.btn-danger-sm:hover {
  background: var(--color-error);
  color: #fff;
}
.btn-ghost-sm {
  padding: 0.3rem 0.6rem;
  font-size: 0.8rem;
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.btn-ghost-sm:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.sound-audio-hidden {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.upload-input-hidden {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
  overflow: hidden;
}

.sound-now-playing {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
  background: var(--color-accent-muted);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  font-size: 0.875rem;
}
.sound-now-playing-label {
  color: var(--color-text-muted);
  font-weight: 500;
}
.sound-now-playing-name {
  flex: 1;
  min-width: 0;
  color: var(--color-text);
  font-weight: 500;
}

.sound-actions {
  display: flex;
  align-items: center;
  min-width: 0;
  margin-right: 1rem;
}
.btn-play {
  background: var(--color-accent-muted);
  color: var(--color-accent);
  border: 1px solid var(--color-accent);
  padding: 0.35rem 0.65rem;
  font-size: 0.8rem;
}
.btn-play:hover:not(:disabled) {
  background: rgba(6, 182, 212, 0.25);
}
.btn-play:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-stop {
  padding: 0.35rem 0.65rem;
  font-size: 0.8rem;
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.btn-stop:hover {
  background: var(--color-border);
  color: var(--color-text);
}
.btn-stop-sm {
  padding: 0.35rem 0.65rem;
  font-size: 0.8rem;
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.btn-stop-sm:hover {
  background: var(--color-border);
  color: var(--color-text);
}

.sound-delete-confirm {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.sound-delete-label {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}
.sound-toast {
  margin: 0 0 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
}
.sound-toast-success {
  background: var(--color-success-muted);
  color: var(--color-success);
}
.sound-toast-error {
  background: var(--color-error-muted);
  color: var(--color-error);
}

.sound-message {
  margin: 0;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}
.sound-error {
  color: var(--color-error);
}

.sound-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sound-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.sound-info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.sound-name {
  font-weight: 500;
  color: var(--color-text);
}

.sound-filename {
  font-size: 0.8rem;
  color: var(--color-text-dim);
  font-family: ui-monospace, monospace;
}
</style>
