<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { SoundFile } from '@/api/sounds'
import { deleteSound, listEffects, listMusic, uploadSound } from '@/api/sounds'

const props = defineProps<{ title: string; type: 'music' | 'effects' }>()

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
}

onMounted(() => {
  loadSounds()
})
</script>

<template>
  <section class="sound-panel">
    <header>
      <h2>{{ title }}</h2>
      <label class="upload-btn">
        <input type="file" accept="audio/*" @change="handleUpload" :disabled="uploading" hidden />
        {{ uploading ? 'Uploading…' : 'Upload' }}
      </label>
    </header>

    <p v-if="loading">Loading…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <p v-else-if="items.length === 0">No sounds yet.</p>

    <ul v-else>
      <li v-for="sound in items" :key="sound.id">
        <div>
          <strong>{{ sound.name }}</strong>
          <small>{{ sound.filename }}</small>
        </div>
        <button type="button" @click="handleDelete(sound.id)">Delete</button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.sound-panel {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 1rem;
  background: var(--color-background);
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.upload-btn {
  border: 1px dashed var(--color-border);
  border-radius: 999px;
  padding: 0.3rem 1rem;
  cursor: pointer;
}

ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  padding: 0.75rem;
}

button {
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.25rem 0.75rem;
}

.error {
  color: #f87171;
}
</style>
