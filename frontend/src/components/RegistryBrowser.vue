<script setup lang="ts">
import type { RegistryEntry } from '@/api/registry'
import { computed, onMounted, ref } from 'vue'
import { getRegistryIndex, installFromRegistry } from '@/api/registry'

const emit = defineEmits<{
  close: []
  installed: [sceneId: string]
}>()

const entries = ref<RegistryEntry[]>([])
const search = ref('')
const loading = ref(false)
const loadError = ref<string | null>(null)
const installingSlug = ref<string | null>(null)
const installMessage = ref<{ type: 'success' | 'error', text: string } | null>(null)

const filtered = computed(() => {
  const q = search.value.toLowerCase().trim()
  if (!q)
    return entries.value
  return entries.value.filter(e =>
    e.name.toLowerCase().includes(q)
    || e.author.toLowerCase().includes(q)
    || e.description.toLowerCase().includes(q)
    || e.tags.some(t => t.toLowerCase().includes(q)),
  )
})

async function load(forceRefresh = false) {
  loading.value = true
  loadError.value = null
  try {
    const index = await getRegistryIndex(forceRefresh)
    entries.value = index.scenes
  }
  catch (err) {
    loadError.value = err instanceof Error ? err.message : 'Failed to load registry'
  }
  finally {
    loading.value = false
  }
}

async function install(entry: RegistryEntry) {
  installingSlug.value = entry.slug
  installMessage.value = null
  try {
    const scene = await installFromRegistry(entry.slug)
    installMessage.value = { type: 'success', text: `Installed "${scene.name}"` }
    emit('installed', scene.id)
  }
  catch (err) {
    installMessage.value = { type: 'error', text: err instanceof Error ? err.message : 'Install failed' }
  }
  finally {
    installingSlug.value = null
  }
}

onMounted(() => load())
</script>

<template>
  <div class="registry-overlay" @click.self="emit('close')">
    <div class="registry-modal" role="dialog" aria-label="Browse Community Scenes">
      <header class="registry-header">
        <h2 class="registry-title">
          Community Scenes
        </h2>
        <button type="button" class="btn-close" aria-label="Close" @click="emit('close')">
          &times;
        </button>
      </header>

      <div class="registry-toolbar">
        <input
          v-model="search"
          type="text"
          class="input registry-search"
          placeholder="Search scenes..."
        >
        <button type="button" class="btn btn-ghost" :disabled="loading" @click="load(true)">
          {{ loading ? '...' : 'Refresh' }}
        </button>
      </div>

      <p
        v-if="installMessage"
        class="status-message"
        :class="[installMessage.type === 'success' ? 'status-message-success' : 'status-message-error']"
      >
        {{ installMessage.text }}
      </p>

      <div v-if="loadError" class="registry-empty">
        <p>{{ loadError }}</p>
        <button type="button" class="btn btn-primary" @click="load(true)">
          Retry
        </button>
      </div>

      <div v-else-if="loading && entries.length === 0" class="registry-empty">
        <p>Loading registry...</p>
      </div>

      <div v-else-if="filtered.length === 0" class="registry-empty">
        <p v-if="entries.length === 0">
          No scenes in the registry yet.
        </p>
        <p v-else>
          No scenes match your search.
        </p>
      </div>

      <div v-else class="registry-list">
        <div v-for="entry in filtered" :key="entry.slug" class="registry-entry">
          <div class="registry-entry-info">
            <div class="registry-entry-header">
              <span class="registry-entry-name">{{ entry.name }}</span>
              <span class="registry-entry-author">by {{ entry.author }}</span>
            </div>
            <p class="registry-entry-desc">
              {{ entry.description }}
            </p>
            <div v-if="entry.tags.length" class="registry-entry-tags">
              <span v-for="tag in entry.tags" :key="tag" class="registry-tag">{{ tag }}</span>
            </div>
          </div>
          <button
            type="button"
            class="btn btn-primary btn-install"
            :disabled="installingSlug === entry.slug"
            @click="install(entry)"
          >
            {{ installingSlug === entry.slug ? '...' : 'Install' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.registry-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-backdrop);
  backdrop-filter: blur(4px);
}

.registry-modal {
  display: flex;
  flex-direction: column;
  width: min(640px, 90vw);
  max-height: 80vh;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.registry-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
}

.registry-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text);
}

.btn-close {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0 0.25rem;
  line-height: 1;
}

.btn-close:hover {
  color: var(--color-text);
}

.registry-toolbar {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
}

.registry-search {
  flex: 1;
  font-size: 0.9rem;
}

.registry-empty {
  padding: 2rem;
  text-align: center;
  color: var(--color-text-muted);
}

.registry-list {
  overflow-y: auto;
  padding: 0.5rem;
}

.registry-entry {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  border-radius: var(--radius-md);
}

.registry-entry:hover {
  background: var(--color-bg-elevated);
}

.registry-entry-info {
  flex: 1;
  min-width: 0;
}

.registry-entry-header {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.registry-entry-name {
  font-weight: 600;
  color: var(--color-text);
}

.registry-entry-author {
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.registry-entry-desc {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.registry-entry-tags {
  display: flex;
  gap: 0.35rem;
  margin-top: 0.35rem;
  flex-wrap: wrap;
}

.registry-tag {
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-dim);
}

.btn-install {
  flex-shrink: 0;
  padding: 0.35rem 0.75rem;
  font-size: 0.85rem;
}

.status-message {
  margin: 0;
  padding: 0.5rem 1.25rem;
  font-size: 0.85rem;
}

.status-message-success {
  color: var(--color-accent);
}

.status-message-error {
  color: var(--color-error);
}
</style>
