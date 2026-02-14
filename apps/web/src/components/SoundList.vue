<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import type { SoundFile } from '@/api/sounds'
import { deleteSound, listEffects, listMusic, soundStreamUrl, uploadSound } from '@/api/sounds'

const props = defineProps<{ title: string; type: 'music' | 'effects' }>()
const emit = defineEmits<{ uploaded: [] }>()

const items = ref<SoundFile[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const uploading = ref(false)
const pendingDeleteId = ref<string | null>(null)
const playingId = ref<string | null>(null)
const audioEl = ref<HTMLAudioElement | null>(null)
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

async function loadSounds() {
  loading.value = true
  error.value = null
  try {
    items.value = props.type === 'music' ? await listMusic() : await listEffects()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unknown error'
  } finally {
    loading.value = false
  }
}

async function handleUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
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

onMounted(() => {
  loadSounds()
})
</script>

<template>
  <section class="sound-panel">
    <header class="panel-header">
      <h2 class="sound-title">{{ title }}</h2>
      <label class="btn btn-upload" :class="{ uploading }">
        <input type="file" accept="audio/*" @change="handleUpload" :disabled="uploading" hidden />
        {{ uploading ? 'Uploading…' : 'Upload' }}
      </label>
    </header>

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
      <li v-for="sound in items" :key="sound.id" class="sound-item">
        <div class="sound-info">
          <span class="sound-name">{{ sound.name }}</span>
          <span class="sound-filename">{{ sound.filename }}</span>
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
