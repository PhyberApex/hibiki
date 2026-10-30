<script setup lang="ts">
import type { Scene } from '@/api/scenes'
import { RouterLink } from 'vue-router'
import HotkeyRecorder from '@/components/HotkeyRecorder.vue'

defineProps<{
  /** The open Scene; null while it loads or after it failed to. */
  scene: Scene | null
  loadError: string | null
  /** The Scene Hotkey's rejection from the last save, if any. */
  hotkeyError?: string
  visionAvailable: boolean
  exportBusy: boolean
}>()

const emit = defineEmits<{
  bindHotkey: [value: string | undefined]
  openVision: []
  export: []
  delete: []
}>()
</script>

<template>
  <header class="detail-header">
    <RouterLink to="/scenes" class="back-link">
      <span class="back-arrow" aria-hidden="true">‹</span>
      Scenes
    </RouterLink>
    <div class="detail-title-row">
      <h1 class="detail-title">
        {{ scene?.name ?? (loadError ? 'Scene unavailable' : 'Loading…') }}
      </h1>
      <HotkeyRecorder
        v-if="scene"
        :model-value="scene.hotkey"
        label="Scene Hotkey"
        :error="hotkeyError"
        @update:model-value="emit('bindHotkey', $event)"
      />
      <div v-if="scene" class="detail-actions">
        <button
          v-if="visionAvailable"
          type="button"
          class="btn btn-ghost btn-vision"
          data-testid="vision-to-vibe-open"
          title="Drop in an image and get matching Music and Ambience from your tagged library"
          @click="emit('openVision')"
        >
          <span class="btn-vision-icon" aria-hidden="true">✦</span>
          Vision to Vibe
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="exportBusy"
          @click="emit('export')"
        >
          {{ exportBusy ? '…' : 'Export' }}
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-danger"
          @click="emit('delete')"
        >
          Delete
        </button>
      </div>
    </div>
  </header>
</template>

<style scoped>
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

/* Compact session layout (899.98px, not 900px: see App.vue; keep in sync
   with it and the other components/scene files):
   Scene editing is hidden. */
@media (max-width: 899.98px) {
  .detail-actions {
    display: none;
  }
}

@media (max-width: 560px) {
  .detail-title-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
  }
}
</style>
