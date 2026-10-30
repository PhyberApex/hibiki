<script setup lang="ts">
import { computed, ref } from 'vue'
import { logInfo } from '@/audio/audio-element-diagnostics'
import { acceleratorFromEvent, isBareTypingKey } from '@/hotkeys/accelerator'

const props = defineProps<{
  modelValue?: string
  /** What the control binds, e.g. "Scene Hotkey"; used in the accessible name. */
  label: string
  /** Rejection from the model validation, e.g. "already used by Scene 'Tavern'". */
  error?: string | null
  /** Keycap-sized control for dense surfaces like the Effect pad; the full button is the default. */
  compact?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | undefined]
}>()

const armed = ref(false)

const warning = computed(() =>
  props.modelValue && isBareTypingKey(props.modelValue)
    ? 'A key without Ctrl, Alt or Super is taken from every other app while Hibiki runs.'
    : null,
)

function arm() {
  armed.value = true
}

function disarm() {
  armed.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (!armed.value)
    return
  if (event.repeat) {
    // Enter arms the button on keydown; its auto-repeat while still held must
    // not be recorded as the binding.
    event.preventDefault()
    event.stopPropagation()
    return
  }
  if (event.code === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
    // Let Tab and Shift+Tab keep moving focus; leaving the button cancels.
    return
  }
  event.preventDefault()
  event.stopPropagation()
  if (event.code === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
    disarm()
    return
  }
  const accelerator = acceleratorFromEvent(event)
  if (!accelerator)
    return
  disarm()
  logInfo(`[hotkeys] recorded ${accelerator} for ${props.label}`)
  emit('update:modelValue', accelerator)
}

function clear() {
  disarm()
  emit('update:modelValue', undefined)
}
</script>

<template>
  <div class="hotkey-recorder" :class="{ 'hotkey-recorder-is-compact': compact }">
    <div class="hotkey-recorder-row">
      <button
        type="button"
        class="hotkey-recorder-button"
        :class="compact ? 'hotkey-recorder-compact' : 'btn btn-ghost'"
        :aria-label="`${label}: ${modelValue ?? 'not set'}. Activate, then press the key combination.`"
        data-testid="hotkey-recorder-button"
        @click="arm"
        @keydown="onKeydown"
        @blur="disarm"
      >
        <template v-if="armed">
          <span class="hotkey-slot hotkey-slot-armed">{{ compact ? 'Press a key…' : 'Press a key… (Esc to cancel)' }}</span>
        </template>
        <template v-else-if="modelValue">
          <kbd class="hotkey-chip">{{ modelValue }}</kbd>
        </template>
        <template v-else>
          <span class="hotkey-slot">Set hotkey</span>
        </template>
      </button>
      <button
        v-if="modelValue"
        type="button"
        class="hotkey-recorder-clear"
        :aria-label="`Clear ${label}`"
        title="Clear hotkey"
        data-testid="hotkey-recorder-clear"
        @mousedown.prevent
        @click="clear"
      >
        ×
      </button>
    </div>
    <span class="hotkey-recorder-live" role="status" aria-live="polite">{{ armed ? `Recording ${label}. Press the key combination, or Escape to cancel.` : '' }}</span>
    <p v-if="armed && !compact" class="hotkey-recorder-hint">
      Try F13–F24 or a modifier combination.
    </p>
    <p v-if="warning" class="hotkey-recorder-warning" data-testid="hotkey-recorder-warning">
      {{ warning }}
    </p>
    <p v-if="error" class="hotkey-recorder-error" role="alert" data-testid="hotkey-recorder-error">
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.hotkey-recorder {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  align-items: flex-start;
}

.hotkey-recorder-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.hotkey-recorder-button {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.btn-ghost .hotkey-slot-armed {
  color: var(--color-accent);
}

.btn-ghost:has(.hotkey-slot-armed) {
  border-color: var(--color-accent);
}

.hotkey-recorder-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-dim);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  transition: color var(--transition), background var(--transition);
}

.hotkey-recorder-clear:hover,
.hotkey-recorder-clear:focus-visible {
  background: var(--color-bg);
  color: var(--color-error);
}

/* Compact: a keycap-sized slot. Empty reads as a dashed outline where the cap
   goes; armed lights the outline amber; bound shows the same chip the lists use. */
.hotkey-recorder-compact {
  padding: 0;
  border: none;
  background: none;
  color: var(--color-text-dim);
  font: inherit;
  font-size: 0.7rem;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  transition: color var(--transition);
}

.hotkey-recorder-compact .hotkey-slot {
  display: inline-block;
  padding: 0.15rem 0.45rem;
  border: 1px dashed var(--color-border-focus);
  border-radius: 0.3rem;
  transition: border-color var(--transition), color var(--transition);
}

.hotkey-recorder-compact:hover,
.hotkey-recorder-compact:focus-visible {
  color: var(--color-text-muted);
}

.hotkey-recorder-compact:hover .hotkey-slot,
.hotkey-recorder-compact:focus-visible .hotkey-slot {
  border-color: var(--color-text-dim);
}

.hotkey-recorder-compact .hotkey-slot-armed,
.hotkey-recorder-compact:hover .hotkey-slot-armed {
  border-style: solid;
  border-color: var(--color-accent);
  color: var(--color-accent);
}

.hotkey-recorder-is-compact .hotkey-recorder-clear {
  width: 1.25rem;
  height: 1.25rem;
  font-size: 0.9rem;
}

.hotkey-recorder-live {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}

.hotkey-recorder-hint,
.hotkey-recorder-warning,
.hotkey-recorder-error {
  margin: 0;
  font-size: 0.75rem;
}

.hotkey-recorder-is-compact .hotkey-recorder-warning,
.hotkey-recorder-is-compact .hotkey-recorder-error {
  font-size: 0.7rem;
  line-height: 1.3;
}

.hotkey-recorder-hint {
  color: var(--color-text-dim);
}

.hotkey-recorder-warning {
  color: var(--color-warning);
}

.hotkey-recorder-error {
  color: var(--color-error);
}
</style>
