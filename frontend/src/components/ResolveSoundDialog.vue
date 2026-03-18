<script setup lang="ts">
import type { SceneItem } from '@/api/scenes'
import type { SoundFile } from '@/api/sounds'
import { ref } from 'vue'
import { openExternal } from '@/api/electron'
import { uploadSound } from '@/api/sounds'

const props = defineProps<{
  item: SceneItem
  category: 'ambience' | 'music' | 'effects'
  sounds: SoundFile[]
}>()

const emit = defineEmits<{
  resolved: [soundId: string, soundName: string]
  close: []
}>()

const uploading = ref(false)
const uploadError = ref<string | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

async function handleFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file)
    return

  uploading.value = true
  uploadError.value = null
  try {
    const result = await uploadSound(props.category, file)
    emit('resolved', result.id, result.name)
  }
  catch (err) {
    uploadError.value = err instanceof Error ? err.message : 'Upload failed'
  }
  finally {
    uploading.value = false
    input.value = ''
  }
}

function handleLinkSelected(event: Event) {
  const select = event.target as HTMLSelectElement
  const id = select.value
  if (!id)
    return
  const sound = props.sounds.find(s => s.id === id)
  if (sound) {
    emit('resolved', sound.id, sound.name)
  }
}
</script>

<template>
  <div class="resolve-overlay" @click.self="emit('close')">
    <div class="resolve-modal" role="dialog" :aria-label="`Resolve missing sound: ${item.soundName ?? item.soundId}`">
      <header class="resolve-header">
        <h2 class="resolve-title">
          Resolve: "{{ item.soundName ?? item.soundId }}"
        </h2>
        <button type="button" class="btn-close" aria-label="Close" @click="emit('close')">
          &times;
        </button>
      </header>

      <div class="resolve-body">
        <div v-if="item.source" class="resolve-source">
          <p class="source-info">
            <span class="source-info-label">Source:</span>
            <a v-if="item.source.url" href="#" class="source-info-link" @click.prevent="openExternal(item.source.url!)">{{ item.source.name }}</a>
            <span v-else class="source-info-name">{{ item.source.name }}</span>
          </p>
          <p v-if="item.source.note" class="source-info-note">
            {{ item.source.note }}
          </p>
        </div>

        <hr class="resolve-divider">

        <div class="resolve-option">
          <label class="resolve-option-label">Upload a file</label>
          <input
            ref="fileInputRef"
            type="file"
            accept="audio/*"
            class="resolve-file-input"
            @change="handleFileSelected"
          >
          <button
            type="button"
            class="btn btn-primary"
            :disabled="uploading"
            @click="fileInputRef?.click()"
          >
            {{ uploading ? 'Uploading...' : 'Choose file' }}
          </button>
          <p v-if="uploadError" class="resolve-error">
            {{ uploadError }}
          </p>
        </div>

        <div class="resolve-separator">
          <span>or</span>
        </div>

        <div class="resolve-option">
          <label class="resolve-option-label">Link from library</label>
          <select class="input resolve-select" @change="handleLinkSelected">
            <option value="">
              Pick from library...
            </option>
            <option v-for="s in sounds" :key="s.id" :value="s.id">
              {{ s.name }}
            </option>
          </select>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.resolve-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-backdrop);
  backdrop-filter: blur(4px);
}

.resolve-modal {
  display: flex;
  flex-direction: column;
  width: min(480px, 90vw);
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.resolve-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
}

.resolve-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-close {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0 0.25rem;
  line-height: 1;
  flex-shrink: 0;
}

.btn-close:hover {
  color: var(--color-text);
}

.resolve-body {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.resolve-source {
  background: var(--color-bg);
  border-radius: var(--radius-md);
  padding: 0.75rem 1rem;
}

.source-info {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-text);
}

.source-info-label {
  font-weight: 500;
  margin-right: 0.35rem;
  color: var(--color-text-muted);
}

.source-info-link {
  color: var(--color-accent);
  text-decoration: none;
}

.source-info-link:hover {
  text-decoration: underline;
}

.source-info-name {
  font-weight: 500;
}

.source-info-note {
  margin: 0.35rem 0 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  font-style: italic;
}

.resolve-divider {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 0;
}

.resolve-option {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.resolve-option-label {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text-muted);
}

.resolve-file-input {
  display: none;
}

.resolve-select {
  width: 100%;
  font-size: 0.9rem;
}

.resolve-separator {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--color-text-dim);
  font-size: 0.8rem;
}

.resolve-separator::before,
.resolve-separator::after {
  content: '';
  flex: 1;
  border-top: 1px solid var(--color-border);
}

.resolve-error {
  margin: 0;
  font-size: 0.85rem;
  color: var(--color-error);
}
</style>
