<script setup lang="ts">
import { computed, ref } from 'vue'
import { acceleratorFromEvent, isBareTypingKey } from '@/hotkeys/accelerator'

const props = defineProps<{
  modelValue?: string
  /** What the control binds, e.g. "Scene Hotkey"; used in the accessible name. */
  label: string
  /** Rejection from the model validation, e.g. "already used by Scene 'Tavern'". */
  error?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | undefined]
}>()

const armed = ref(false)

const warning = computed(() =>
  props.modelValue && isBareTypingKey(props.modelValue)
    ? 'A bare letter or digit is taken from every other app while Hibiki runs.'
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
  emit('update:modelValue', accelerator)
}

function clear() {
  disarm()
  emit('update:modelValue', undefined)
}
</script>

<template>
  <div class="hotkey-recorder">
    <div class="hotkey-recorder-row">
      <button
        type="button"
        class="btn btn-ghost hotkey-recorder-button"
        :class="{ 'hotkey-recorder-armed': armed }"
        :aria-label="`${label}: ${modelValue ?? 'not set'}. Activate, then press the key combination.`"
        data-testid="hotkey-recorder-button"
        @click="arm"
        @keydown="onKeydown"
        @blur="disarm"
      >
        <template v-if="armed">
          Press a key… (Esc to cancel)
        </template>
        <template v-else-if="modelValue">
          <kbd class="hotkey-chip">{{ modelValue }}</kbd>
        </template>
        <template v-else>
          Set hotkey
        </template>
      </button>
      <button
        v-if="modelValue"
        type="button"
        class="btn-icon hotkey-recorder-clear"
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
    <p v-if="armed" class="hotkey-recorder-hint">
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

.hotkey-recorder-armed {
  border-color: var(--accent, #06b6d4);
  color: var(--accent, #06b6d4);
}

.hotkey-chip {
  font-family: inherit;
  font-weight: 600;
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

.hotkey-recorder-hint {
  opacity: 0.6;
}

.hotkey-recorder-warning {
  color: #fbbf24;
}

.hotkey-recorder-error {
  color: #f87171;
}
</style>
