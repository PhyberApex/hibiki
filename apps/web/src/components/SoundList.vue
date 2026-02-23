<script setup lang="ts">
import type { SoundFile } from '@/api/sounds'
import { computed, nextTick, onMounted, ref } from 'vue'
import { listEffects, listMusic, soundStreamUrl } from '@/api/sounds'

const props = defineProps<{ title: string, type: 'music' | 'effects' }>()

const items = ref<SoundFile[]>([])
const filterQuery = ref('')
const loading = ref(true)
const error = ref<string | null>(null)
const playingId = ref<string | null>(null)
const audioEl = ref<HTMLAudioElement | null>(null)

async function loadSounds() {
  loading.value = true
  error.value = null
  try {
    items.value
      = props.type === 'music' ? await listMusic() : await listEffects()
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : 'Unknown error'
  }
  finally {
    loading.value = false
  }
}

const filteredItems = computed(() => {
  const q = filterQuery.value.trim().toLowerCase()
  if (!q)
    return [...items.value].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return items.value
    .filter(s => s.name.toLowerCase().includes(q) || (s.filename ?? '').toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
})

function playUrl(id: string) {
  return soundStreamUrl(props.type, id)
}

function stop() {
  const el = audioEl.value
  if (el) {
    el.pause()
    el.removeAttribute('src')
  }
  playingId.value = null
}

async function togglePlay(id: string) {
  if (playingId.value === id) {
    stop()
    return
  }
  playingId.value = id
  await nextTick()
  const el = audioEl.value
  if (el) {
    el.src = playUrl(id)
    el.play().catch(() => {
      stop()
    })
  }
}

function onAudioEnded() {
  playingId.value = null
}

const playingSound = computed(() => {
  if (!playingId.value)
    return null
  return items.value.find(s => s.id === playingId.value) || null
})

onMounted(() => {
  loadSounds()
})
</script>

<template>
  <section class="sound-panel">
    <header class="panel-header">
      <h2 class="sound-title">
        {{ title }}
      </h2>
    </header>

    <div class="sound-filters">
      <label class="filter-row">
        <span class="filter-label">Filter</span>
        <input
          v-model="filterQuery"
          type="search"
          class="field-input filter-input"
          placeholder="Search by name or filename…"
          aria-label="Filter sounds"
        >
      </label>
    </div>

    <audio ref="audioEl" class="sound-audio-hidden" @ended="onAudioEnded" />

    <div v-if="playingSound" class="sound-now-playing">
      <span class="sound-now-playing-label">Now playing:</span>
      <span class="sound-now-playing-name">{{ playingSound.name }}</span>
      <button type="button" class="btn btn-stop" @click="stop">
        Stop
      </button>
    </div>

    <p v-if="loading" class="sound-message">
      Loading…
    </p>
    <p v-else-if="error" class="sound-message sound-error">
      {{ error }}
    </p>
    <p v-else-if="filteredItems.length === 0" class="sound-message">
      {{ filterQuery.trim() ? 'No matching sounds.' : 'No sounds yet.' }}
    </p>

    <ul v-else class="sound-list">
      <li v-for="sound in filteredItems" :key="sound.id" class="sound-item">
        <div class="sound-info">
          <span class="sound-name">{{ sound.name }}</span>
          <span class="sound-filename">{{ sound.filename }}</span>
        </div>
        <div class="sound-actions">
          <button
            v-if="playingId === sound.id"
            type="button"
            class="btn btn-stop-sm"
            @click="stop"
          >
            Stop
          </button>
          <button
            v-else
            type="button"
            class="btn btn-play"
            :title="`Play ${sound.name}`"
            @click="togglePlay(sound.id)"
          >
            Play
          </button>
        </div>
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

.sound-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1rem;
}
.filter-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 200px;
}
.filter-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.field-input {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.35rem 0.6rem;
  font-size: 0.85rem;
  color: var(--color-text);
}
.filter-input {
  flex: 1;
  min-width: 0;
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

.sound-audio-hidden {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}

.sound-now-playing {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
  background: var(--color-accent-muted);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  font-size: 0.875rem;
}
.sound-now-playing-label {
  color: var(--color-text-muted);
  font-weight: 500;
}
.sound-now-playing-name {
  flex: 1;
  min-width: 0;
  color: var(--color-text);
  font-weight: 500;
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

.sound-actions {
  display: flex;
  align-items: center;
  min-width: 0;
}
.btn-play {
  background: var(--color-accent-muted);
  color: var(--color-accent);
  border: 1px solid var(--color-accent);
  padding: 0.35rem 0.65rem;
  font-size: 0.8rem;
}
.btn-play:hover {
  background: rgba(6, 182, 212, 0.25);
}
.btn-stop {
  padding: 0.35rem 0.65rem;
  font-size: 0.8rem;
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.btn-stop:hover {
  background: var(--color-border);
  color: var(--color-text);
}
.btn-stop-sm {
  padding: 0.35rem 0.65rem;
  font-size: 0.8rem;
  background: var(--color-bg);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.btn-stop-sm:hover {
  background: var(--color-border);
  color: var(--color-text);
}
</style>
