<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { SoundFile } from '@/api/sounds'
import { deleteSound, listEffects, listMusic, uploadSound } from '@/api/sounds'

const props = defineProps<{ title: string; type: 'music' | 'effects' }>()
const emit = defineEmits<{ uploaded: [] }>()

const items = ref<SoundFile[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const uploading = ref(false)

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

async function handleDelete(id: string) {
  if (!confirm('Delete this file?')) return
  await deleteSound(props.type, id)
  await loadSounds()
  emit('uploaded')
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

    <p v-if="loading" class="sound-message">Loading…</p>
    <p v-else-if="error" class="sound-message sound-error">{{ error }}</p>
    <p v-else-if="items.length === 0" class="sound-message">No sounds yet.</p>

    <ul v-else class="sound-list">
      <li v-for="sound in items" :key="sound.id" class="sound-item">
        <div class="sound-info">
          <span class="sound-name">{{ sound.name }}</span>
          <span class="sound-filename">{{ sound.filename }}</span>
        </div>
        <button type="button" class="btn btn-danger-ghost" @click="handleDelete(sound.id)">Delete</button>
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
.btn-danger-ghost:hover {
  background: var(--color-error-muted);
  color: var(--color-error);
  border-color: var(--color-error);
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
