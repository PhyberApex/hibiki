<script setup lang="ts">
import type { SceneItem } from '@/api/scenes'
import type { SoundFile } from '@/api/sounds'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useScenePlaybackStore } from '@/stores/scene-playback'
import { formatInterval, INTERVAL_OPTIONS, isMissingFrom, itemName } from './scene-format'

// The open Scene's Ambience items are edited in place; every edit asks the
// Scene view to save it through `persist`, which also rolls a failed save back.
const props = defineProps<{
  items: SceneItem[]
  /** The Ambience half of the Sound Library. */
  sounds: SoundFile[]
}>()

const emit = defineEmits<{
  add: [sound: SoundFile]
  remove: [soundId: string]
  resolve: [item: SceneItem]
  persist: [what: string]
}>()

const playback = useScenePlaybackStore()
const { playingAmbienceIds } = storeToRefs(playback)

const addable = computed(() => props.sounds.filter(x => !props.items.some(a => a.soundId === x.id)))

function nameOf(item: SceneItem): string {
  return itemName(props.sounds, item)
}

function isMissing(item: SceneItem): boolean {
  return isMissingFrom(props.sounds, item.soundId)
}

function onAdd(event: Event) {
  const select = event.target as HTMLSelectElement
  const sound = props.sounds.find(x => x.id === select.value)
  if (sound)
    emit('add', sound)
  select.value = ''
}

function toggle(item: SceneItem) {
  emit('persist', `${item.soundName ?? item.soundId} ${item.enabled
    ? 'on'
    : 'off'}`)
  playback.toggleAmbience(item)
}

function updateRepeat(item: SceneItem, field: 'repeatMin' | 'repeatMax', value: number) {
  item[field] = value
  if (field === 'repeatMin' && (item.repeatMax ?? 0) < value)
    item.repeatMax = value
  if (field === 'repeatMax' && value < (item.repeatMin ?? 0))
    item.repeatMin = value
  emit('persist', `the repeat interval of ${item.soundName ?? item.soundId}`)
}
</script>

<template>
  <section class="scene-section scene-section-ambience">
    <div class="section-header">
      <h2 class="section-title">
        Ambience
      </h2>
      <select
        class="add-select"
        aria-label="Add ambience"
        @change="onAdd"
      >
        <option value="">
          Add ambience…
        </option>
        <option
          v-for="s in addable"
          :key="s.id"
          :value="s.id"
        >
          {{ s.name }}
        </option>
      </select>
    </div>
    <div class="sound-cards">
      <div
        v-for="item in items"
        :key="item.soundId"
        class="sound-card sound-card-ambience"
        :class="{ 'pulse pulse-breathe': playingAmbienceIds.has(item.soundId) }"
      >
        <div class="sound-card-row">
          <div class="sound-card-info">
            <span class="sound-name">{{ nameOf(item) }}</span>
            <span v-if="isMissing(item)" class="sound-missing-badge">
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
              :aria-label="`Volume for ${nameOf(item)}`"
              @input="playback.updateAmbienceVolume(item)"
              @change="emit('persist', `the volume of ${item.soundName ?? item.soundId}`)"
            >
            <label class="toggle">
              <input
                v-model="item.enabled"
                type="checkbox"
                :aria-label="`Enable ${nameOf(item)}`"
                :disabled="isMissing(item)"
                @change="toggle(item)"
              >
            </label>
            <button
              type="button"
              class="btn-icon btn-remove"
              title="Remove"
              :aria-label="`Remove ${nameOf(item)}`"
              @click="emit('remove', item.soundId)"
            >
              ×
            </button>
          </div>
        </div>
        <div v-if="isMissing(item)" class="sound-source-hint">
          <button
            type="button"
            class="btn-resolve"
            @click="emit('resolve', item)"
          >
            Resolve missing sound...
          </button>
        </div>
        <div class="ambience-repeat-row">
          <span class="repeat-label">Repeat every</span>
          <select
            class="repeat-select"
            :aria-label="`Shortest repeat interval for ${nameOf(item)}`"
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
            :aria-label="`Longest repeat interval for ${nameOf(item)}`"
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
    <p v-if="items.length === 0" class="section-empty">
      No ambience yet. Ambience loops continuously in the background — rain, wind, tavern chatter. Use the dropdown above to add tracks.
    </p>
  </section>
</template>

<style scoped src="./scene-section.css"></style>

<style scoped>
.scene-section-ambience {
  --section-color: var(--color-ambience);
}

.sound-card-ambience {
  --pulse-color: var(--color-ambience);
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

/* Compact session layout (899.98px, kept in sync with SceneView and App.vue):
   Scene editing is hidden, Effects + playback only. */
@media (max-width: 899.98px) {
  .scene-section-ambience {
    display: none;
  }
}
</style>
