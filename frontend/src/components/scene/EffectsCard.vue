<script setup lang="ts">
import type { SceneItem } from '@/api/scenes'
import type { SoundFile } from '@/api/sounds'
import { computed } from 'vue'
import HotkeyRecorder from '@/components/HotkeyRecorder.vue'
import { usePlayerStore } from '@/stores/player'
import { useScenePlaybackStore } from '@/stores/scene-playback'
import { isMissingFrom, itemName, progressPercent, timerLabel } from './scene-format'

const props = defineProps<{
  items: SceneItem[]
  /** The Effects half of the Sound Library. */
  sounds: SoundFile[]
  /** Hotkey rejections from the last save, keyed `effect:<soundId>`. */
  hotkeyErrors: Record<string, string>
}>()

const emit = defineEmits<{
  add: [sound: SoundFile]
  remove: [soundId: string]
  resolve: [item: SceneItem]
  /** The Scene view saves the binding and reports a rejection back through `hotkeyErrors`. */
  bindHotkey: [errorKey: string, item: SceneItem, value: string | undefined]
}>()

const player = usePlayerStore()
const playback = useScenePlaybackStore()
const { effectFlash } = playback

const addable = computed(() => props.sounds.filter(x => !props.items.some(ef => ef.soundId === x.id)))

// One `player.effectStatus()` scan per Effect item per reactive tick, shared by the whole card.
const effectCards = computed(() => props.items.map(item => ({
  item,
  status: player.effectStatus(item.soundId),
})))

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
</script>

<template>
  <section class="scene-section scene-section-effects">
    <div class="section-header">
      <h2 class="section-title">
        Effects
      </h2>
      <select
        class="add-select"
        aria-label="Add effect"
        @change="onAdd"
      >
        <option value="">
          Add effect…
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
    <div class="sound-cards effect-cards">
      <div
        v-for="{ item, status } in effectCards"
        :key="item.soundId"
        class="effect-card"
        :class="{
          'effect-card-missing': isMissing(item),
          'effect-card-playing': Boolean(status),
          'pulse pulse-flash': effectFlash.has(item.soundId),
        }"
      >
        <button
          type="button"
          class="effect-trigger"
          :disabled="isMissing(item)"
          :title="isMissing(item) ? 'Sound missing' : `Play ${nameOf(item)}`"
          @click="playback.playEffect(item)"
        >
          <span
            v-if="status"
            class="effect-progress-fill"
            :style="{ width: `${progressPercent(status)}%` }"
          />
          <span class="effect-trigger-content">
            <span class="effect-name">{{ nameOf(item) }}</span>
            <span v-if="status" class="effect-timer">{{ timerLabel(status) }}</span>
          </span>
          <span v-if="isMissing(item)" class="sound-missing-badge">
            missing
          </span>
          <span v-if="status && status.count > 1" class="effect-count-badge">
            ×{{ status.count }}
          </span>
        </button>
        <button
          v-if="status"
          type="button"
          class="btn-icon effect-stop"
          title="Stop"
          :aria-label="`Stop ${nameOf(item)}`"
          @click="player.stopEffectSound(item.soundId)"
        >
          ■
        </button>
        <button
          type="button"
          class="btn-icon btn-remove effect-remove"
          title="Remove"
          :aria-label="`Remove ${nameOf(item)}`"
          @click="emit('remove', item.soundId)"
        >
          ×
        </button>
        <HotkeyRecorder
          class="effect-hotkey-recorder"
          compact
          data-testid="effect-hotkey-recorder"
          :model-value="item.hotkey"
          :label="`Effect Hotkey for ${nameOf(item)}`"
          :error="hotkeyErrors[`effect:${item.soundId}`]"
          @update:model-value="emit('bindHotkey', `effect:${item.soundId}`, item, $event)"
        />
        <div v-if="isMissing(item)" class="sound-source-hint effect-resolve-hint">
          <button
            type="button"
            class="btn-resolve"
            @click="emit('resolve', item)"
          >
            Resolve…
          </button>
        </div>
      </div>
    </div>
    <p v-if="items.length === 0" class="section-empty">
      No effects yet. Effects are one-shot sounds you trigger on demand — a thunder clap, a door slam. Use the dropdown above to add some.
    </p>
  </section>
</template>

<style scoped src="./scene-section.css"></style>

<style scoped>
.scene-section-effects {
  --section-color: var(--color-effects);
}

/* ── Dense trigger grid ── */

.effect-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 0.5rem;
}

.effect-card {
  --pulse-color: var(--color-effects);
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.effect-trigger {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.75rem;
  padding-right: 2rem;
  background: none;
  border: none;
  color: var(--color-text);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  transition: background 0.15s;
}

.effect-trigger:hover:not(:disabled) {
  background: var(--color-effects-muted);
}

.effect-trigger:active:not(:disabled) {
  background: var(--color-effects-muted-hover);
}

.effect-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Sweeps across the trigger button as the longest-remaining instance
   plays out — a plain width percentage, no transition: a mid-playback Stop
   or eviction must make this disappear instantly, not animate out. */
.effect-progress-fill {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 0;
  background: var(--color-effects-muted);
}

.effect-trigger-content {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  flex: 1;
}

.effect-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.effect-timer {
  font-size: 0.7rem;
  font-weight: 400;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.effect-count-badge {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-effects);
}

.effect-card-playing .effect-trigger {
  padding-right: 3.75rem;
}

.effect-stop,
.effect-remove {
  position: absolute;
  top: 0.35rem;
  right: 0.25rem;
  z-index: 2;
  width: 1.5rem;
  height: 1.5rem;
}

.effect-stop {
  font-size: 0.7rem;
  background: var(--color-bg);
  color: var(--color-effects);
}

.effect-remove {
  font-size: 1rem;
  background: transparent;
  opacity: 0;
  transition: opacity 0.15s;
}

.effect-card-playing .effect-remove {
  right: 2rem;
}

.effect-card:hover .effect-remove {
  opacity: 1;
}

.effect-hotkey-recorder {
  padding: 0 0.75rem 0.45rem;
}

.effect-card-missing {
  border-color: var(--color-error-muted);
}

.effect-resolve-hint {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

/* Compact session layout (899.98px, kept in sync with SceneView and App.vue):
   the GM can still fire Effects, but not add, remove or relink them. */
@media (max-width: 899.98px) {
  .add-select,
  .effect-remove,
  .effect-resolve-hint {
    display: none;
  }
}
</style>
