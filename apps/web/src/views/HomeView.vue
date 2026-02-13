<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { PlayerStateItem } from '@/api/player'
import { fetchPlayerState } from '@/api/player'
import SoundList from '@/components/SoundList.vue'
import PlayerControls from '@/components/PlayerControls.vue'

const state = ref<PlayerStateItem[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
/** Bump when sounds are uploaded/deleted so PlayerControls refetches dropdowns */
const soundsVersion = ref(0)
function onSoundsUpdated() {
  soundsVersion.value += 1
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

function formatRelative(iso?: string) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = date.getTime() - Date.now()
  const diffMinutes = Math.round(diffMs / 60000)
  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, 'minute')
  }
  const diffHours = Math.round(diffMinutes / 60)
  return rtf.format(diffHours, 'hour')
}

async function loadState() {
  loading.value = true
  error.value = null
  try {
    state.value = await fetchPlayerState()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Unknown error'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadState()
})
</script>

<template>
  <main class="dashboard">
    <header class="page-header">
      <div>
        <p class="eyebrow">Status</p>
        <h1>Control Center</h1>
      </div>
      <button type="button" class="btn btn-ghost" @click="loadState" :disabled="loading">
        {{ loading ? 'Refreshing…' : 'Refresh' }}
      </button>
    </header>

    <section class="panel">
      <div class="panel-header">
        <div>
          <p class="eyebrow">Playback</p>
          <h2>Player state</h2>
        </div>
        <span class="tag" :class="{ 'tag-error': error }">
          {{ error ? 'Error' : loading ? 'Syncing' : 'Live' }}
        </span>
      </div>
      <p v-if="loading" class="panel-message">Loading player state…</p>
      <p v-else-if="error" class="panel-message panel-error">{{ error }}</p>
      <p v-else-if="state.length === 0" class="panel-message">No guilds connected.</p>

      <ul v-else class="state-list">
        <li v-for="guild in state" :key="guild.guildId" class="state-card">
          <div class="state-card-header">
            <span class="state-guild-id">{{ guild.guildId }}</span>
            <span :class="['pill', guild.source === 'live' ? 'pill-live' : 'pill-snapshot']">
              {{ guild.source === 'live' ? 'Live' : 'Snapshot' }}
            </span>
          </div>
          <dl class="state-dl">
            <div class="state-row">
              <dt>Channel</dt>
              <dd>{{ guild.connectedChannelName ?? '—' }}</dd>
            </div>
            <div class="state-row">
              <dt>Status</dt>
              <dd class="state-status">{{ guild.isIdle ? 'Idle' : 'Playing' }}</dd>
            </div>
            <div v-if="guild.lastUpdated" class="state-row">
              <dt>Updated</dt>
              <dd class="state-muted">{{ formatRelative(guild.lastUpdated) }}</dd>
            </div>
            <div class="state-row">
              <dt>Track</dt>
              <dd>
                <template v-if="guild.track">
                  {{ guild.track.name }}
                  <span class="state-category">{{ guild.track.category }}</span>
                </template>
                <template v-else>—</template>
              </dd>
            </div>
          </dl>
        </li>
      </ul>
    </section>

    <PlayerControls :sounds-version="soundsVersion" />


    <div class="sound-grid">
      <SoundList title="Music" type="music" @uploaded="onSoundsUpdated" />
      <SoundList title="Effects" type="effects" @uploaded="onSoundsUpdated" />
    </div>
  </main>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  max-width: 1000px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.eyebrow {
  margin: 0;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--color-text-dim);
}

.page-header h1 {
  margin: 0.2rem 0 0;
  font-size: 1.75rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.btn {
  border: none;
  border-radius: var(--radius-md);
  padding: 0.5rem 1rem;
  font-size: 0.9rem;
  font-weight: 500;
  transition: background var(--transition), opacity var(--transition);
}

.btn-ghost {
  background: var(--color-bg-card);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}
.btn-ghost:hover:not(:disabled) {
  background: var(--color-border);
  color: var(--color-text);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.panel {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  box-shadow: var(--shadow-card);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 1.25rem;
}

.panel-header .eyebrow {
  margin: 0;
}

.panel-header h2 {
  margin: 0.2rem 0 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.tag {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.25rem 0.6rem;
  border-radius: var(--radius-full);
  background: var(--color-success-muted);
  color: var(--color-live);
}
.tag-error {
  background: var(--color-error-muted);
  color: var(--color-error);
}

.panel-message {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.95rem;
}
.panel-error {
  color: var(--color-error);
}

.state-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 1rem;
}

.state-card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1.1rem 1.25rem;
}

.state-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.state-guild-id {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-dim);
  font-family: ui-monospace, monospace;
}

.pill {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.2rem 0.5rem;
  border-radius: var(--radius-full);
}
.pill-live {
  background: var(--color-success-muted);
  color: var(--color-live);
}
.pill-snapshot {
  background: var(--color-border);
  color: var(--color-text-muted);
}

.state-dl {
  margin: 0;
  display: grid;
  gap: 0.4rem;
}

.state-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 0.9rem;
  gap: 1rem;
}

.state-row dt {
  margin: 0;
  font-weight: 500;
  color: var(--color-text-muted);
}

.state-row dd {
  margin: 0;
  color: var(--color-text);
}

.state-status {
  font-weight: 500;
}

.state-muted {
  color: var(--color-text-muted) !important;
}

.state-category {
  font-size: 0.8rem;
  color: var(--color-text-dim);
  margin-left: 0.35rem;
}

.sound-grid {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}
</style>
