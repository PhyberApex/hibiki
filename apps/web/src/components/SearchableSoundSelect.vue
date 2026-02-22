<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

export interface SoundOption {
  id: string
  name: string
}

const props = withDefaults(
  defineProps<{
    options: SoundOption[]
    modelValue: string
    placeholder?: string
    disabled?: boolean
  }>(),
  { placeholder: 'Select…', disabled: false },
)
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const open = ref(false)
const query = ref('')
const highlightedIndex = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLDivElement | null>(null)
let blurTimer: ReturnType<typeof setTimeout> | null = null

const selectedOption = computed(() =>
  props.options.find(o => o.id === props.modelValue),
)

const displayText = computed(() => {
  if (open.value)
    return query.value
  return selectedOption.value?.name ?? ''
})

const filteredOptions = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q)
    return props.options
  return props.options.filter(o =>
    o.name.toLowerCase().includes(q),
  )
})

const highlightedId = computed(() => {
  const list = filteredOptions.value
  if (list.length === 0)
    return null
  const idx = Math.max(0, Math.min(highlightedIndex.value, list.length - 1))
  return list[idx]?.id ?? null
})

function openDropdown() {
  if (props.disabled)
    return
  open.value = true
  query.value = ''
  const idx = props.modelValue
    ? filteredOptions.value.findIndex(o => o.id === props.modelValue)
    : 0
  highlightedIndex.value = idx >= 0 ? idx : 0
  nextTick(() => {
    scrollHighlightedIntoView()
  })
}

function closeDropdown() {
  open.value = false
  query.value = ''
}

function onInput(e: Event) {
  const target = e.target as HTMLInputElement
  query.value = target.value
  open.value = true
  highlightedIndex.value = 0
  nextTick(() => scrollHighlightedIntoView())
}

function select(id: string) {
  emit('update:modelValue', id)
  closeDropdown()
  inputEl.value?.blur()
}

function onFocus() {
  if (blurTimer) {
    clearTimeout(blurTimer)
    blurTimer = null
  }
  openDropdown()
}

function onBlur() {
  blurTimer = setTimeout(() => {
    blurTimer = null
    closeDropdown()
  }, 150)
}

function onKeydown(e: KeyboardEvent) {
  if (!open.value) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault()
      openDropdown()
    }
    return
  }
  const list = filteredOptions.value
  if (e.key === 'Escape') {
    e.preventDefault()
    closeDropdown()
    inputEl.value?.blur()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const id = highlightedId.value
    if (id)
      select(id)
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    highlightedIndex.value = Math.min(highlightedIndex.value + 1, list.length - 1)
    nextTick(() => scrollHighlightedIntoView())
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    highlightedIndex.value = Math.max(highlightedIndex.value - 1, 0)
    nextTick(() => scrollHighlightedIntoView())
  }
}

function scrollHighlightedIntoView() {
  const list = listEl.value
  if (!list)
    return
  const item = list.querySelector('[data-highlighted="true"]')
  item?.scrollIntoView({ block: 'nearest' })
}

watch(() => props.options, () => {
  if (open.value)
    highlightedIndex.value = Math.min(highlightedIndex.value, filteredOptions.value.length - 1)
}, { deep: true })
</script>

<template>
  <div class="searchable-select" :class="{ open, disabled }">
    <input
      ref="inputEl"
      type="text"
      class="searchable-select-input"
      :value="displayText"
      :placeholder="placeholder"
      :disabled="disabled"
      autocomplete="off"
      role="combobox"
      :aria-expanded="open"
      aria-haspopup="listbox"
      aria-controls="listbox"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
    >
    <div
      v-show="open && filteredOptions.length > 0"
      id="listbox"
      ref="listEl"
      class="searchable-select-list"
      role="listbox"
    >
      <button
        v-for="opt in filteredOptions"
        :key="opt.id"
        type="button"
        class="searchable-select-option"
        :class="{ highlighted: opt.id === highlightedId }"
        :data-highlighted="opt.id === highlightedId"
        role="option"
        :aria-selected="opt.id === modelValue"
        @mousedown.prevent="select(opt.id)"
      >
        {{ opt.name }}
      </button>
    </div>
    <div
      v-show="open && filteredOptions.length === 0"
      class="searchable-select-empty"
      role="status"
    >
      No matches
    </div>
  </div>
</template>

<style scoped>
.searchable-select {
  position: relative;
  width: 100%;
}

/* Match site field-input styling (dark theme, same as native selects) */
.searchable-select-input {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: 0.9rem;
  padding: 0.5rem 0.75rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  transition: border-color var(--transition);
}
.searchable-select-input::placeholder {
  color: var(--color-text-muted);
}
.searchable-select-input:focus {
  outline: none;
  border-color: var(--color-border-focus);
}
.searchable-select-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.searchable-select-list {
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  margin-top: 2px;
  max-height: 12rem;
  overflow-y: auto;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-card);
  z-index: 10;
}

.searchable-select-option {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.5rem 0.75rem;
  font-size: 0.9rem;
  color: var(--color-text);
  background: none;
  border: none;
  cursor: pointer;
  transition: background var(--transition);
}

.searchable-select-option:hover,
.searchable-select-option.highlighted {
  background: var(--color-accent-muted);
  color: var(--color-accent);
}

.searchable-select-empty {
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  margin-top: 2px;
  padding: 0.5rem 0.75rem;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  z-index: 10;
}
</style>
