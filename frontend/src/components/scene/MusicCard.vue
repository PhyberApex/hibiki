<script setup lang="ts">
import type { MusicMode, SceneItem } from '@/api/scenes'
import type { SoundFile } from '@/api/sounds'
import type { MusicProgress } from '@/stores/scene-playback'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { usePlayerStore } from '@/stores/player'
import { useScenePlaybackStore } from '@/stores/scene-playback'
import { isMissingFrom, itemName, progressPercent, timerLabel } from './scene-format'

// The open Scene's Music items are edited in place; every edit asks the Scene
// view to save it through `persist`, which also rolls a failed save back.
const props = defineProps<{
  items: SceneItem[]
  /** The Music half of the Sound Library. */
  sounds: SoundFile[]
  musicMode: MusicMode
}>()

const emit = defineEmits<{
  'add': [sound: SoundFile]
  'remove': [soundId: string]
  'resolve': [item: SceneItem]
  'persist': [what: string]
  'update:musicMode': [mode: MusicMode]
}>()

const MUSIC_MODE_OPTIONS: { value: MusicMode, label: string, title: string }[] = [
  { value: 'single', label: 'Single', title: 'Play one track; its Loop toggle repeats it' },
  { value: 'sequential', label: 'Sequential', title: 'Play the tracks in order, starting over after the last' },
  { value: 'shuffle', label: 'Shuffle', title: 'Play every track once in random order, then reshuffle' },
]

const player = usePlayerStore()
const playback = useScenePlaybackStore()
const { playingMusicId, musicProgress } = storeToRefs(playback)

const addable = computed(() => props.sounds.filter(x => !props.items.some(m => m.soundId === x.id)))

function nameOf(item: SceneItem): string {
  return itemName(props.sounds, item)
}

function isMissing(item: SceneItem): boolean {
  return isMissingFrom(props.sounds, item.soundId)
}

/** The playing Music track's progress when `soundId` is that track, else null. */
function progressFor(soundId: string): MusicProgress | null {
  return musicProgress.value?.soundId === soundId
    ? musicProgress.value
    : null
}

function onAdd(event: Event) {
  const select = event.target as HTMLSelectElement
  const sound = props.sounds.find(x => x.id === select.value)
  if (sound)
    emit('add', sound)
  select.value = ''
}
</script>

<template>
  <section class="scene-section scene-section-music">
    <div class="section-header">
      <h2 class="section-title">
        Music
      </h2>
      <div class="music-mode-toggle" role="group" aria-label="Music Mode">
        <button
          v-for="option in MUSIC_MODE_OPTIONS"
          :key="option.value"
          type="button"
          class="btn btn-ghost music-mode-option"
          :class="{ 'music-mode-option-active': musicMode === option.value }"
          :aria-pressed="musicMode === option.value"
          :title="option.title"
          @click="emit('update:musicMode', option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <select
        class="add-select"
        aria-label="Add music"
        @change="onAdd"
      >
        <option value="">
          Add music…
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
        class="sound-card"
        :class="{
          'sound-card-has-hint': isMissing(item),
          'sound-card-music-timed': progressFor(item.soundId),
        }"
      >
        <span
          v-if="progressFor(item.soundId)"
          class="music-progress-fill"
          :style="{ width: `${progressPercent(progressFor(item.soundId)!)}%` }"
        />
        <div class="sound-card-main-row">
          <div class="sound-card-info">
            <span class="sound-name">{{ nameOf(item) }}</span>
            <span v-if="progressFor(item.soundId)" class="music-timer">{{ timerLabel(progressFor(item.soundId)!) }}</span>
            <span v-if="isMissing(item)" class="sound-missing-badge">
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
              @click="playback.stopMusicPlayback()"
            >
              ■
            </button>
            <button
              v-else
              type="button"
              class="btn-icon"
              :disabled="!player.canPlay || isMissing(item)"
              title="Play"
              :aria-label="`Play ${nameOf(item)}`"
              @click="playback.playMusicTrack(item)"
            >
              ▶
            </button>
            <input
              v-model.number="item.volume"
              type="range"
              min="0"
              max="100"
              class="volume-slider"
              :aria-label="`Volume for ${nameOf(item)}`"
              @input="playback.updateMusicVolume(item)"
              @change="emit('persist', `the volume of ${item.soundName ?? item.soundId}`)"
            >
            <label v-if="musicMode === 'single'" class="toggle" title="Loop">
              <input v-model="item.loop" type="checkbox" :aria-label="`Loop ${nameOf(item)}`" @change="emit('persist', `the loop of ${item.soundName ?? item.soundId}`)">
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
      </div>
    </div>
    <p v-if="items.length === 0" class="section-empty">
      No music yet. Music plays one track at a time — great for background themes. Use the dropdown above to add tracks.
    </p>
  </section>
</template>

<style scoped src="./scene-section.css"></style>

<style scoped>
.scene-section-music {
  --section-color: var(--color-music);
}

.music-mode-toggle {
  display: inline-flex;
  margin-left: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.music-mode-option {
  border: none;
  border-radius: 0;
  padding: 0.25rem 0.6rem;
  font-size: 0.75rem;
}

.music-mode-option-active {
  background: var(--color-accent-muted);
  color: var(--color-text);
}

.sound-card-music-timed {
  position: relative;
  overflow: hidden;
}

/* The playing Music track's progress (#695): a thin bar along the card's
   bottom edge, no transition, so a Stop removes it at once. */
.music-progress-fill {
  position: absolute;
  inset: auto auto 0 0;
  height: 2px;
  background: var(--color-music);
  opacity: 0.7;
}

.music-timer {
  flex-shrink: 0;
  font-size: 0.7rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
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

.sound-card-controls-music {
  gap: 0.5rem;
}

.btn-icon-active {
  background: var(--color-error-muted);
  color: var(--color-error);
}

.btn-icon-active:hover {
  background: var(--color-error);
  color: var(--color-on-accent-bg);
}

/* Compact session layout (899.98px, kept in sync with SceneView and App.vue):
   Scene editing is hidden, Effects + playback only. */
@media (max-width: 899.98px) {
  .scene-section-music {
    display: none;
  }
}
</style>
