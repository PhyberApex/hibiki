<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { PlayerStateItem } from '@/api/player'
import { fetchPlayerState } from '@/api/player'
import SoundList from '@/components/SoundList.vue'
import PlayerControls from '@/components/PlayerControls.vue'

const state = ref<PlayerStateItem[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

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
    <section class="panel">
      <header>
        <h1>Player state</h1>
        <button type="button" @click="loadState" :disabled="loading">
          {{ loading ? 'Refreshing…' : 'Refresh' }}
        </button>
      </header>

      <p v-if="loading">Loading player state…</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <p v-else-if="state.length === 0">No guilds connected.</p>

      <ul v-else class="state-list">
        <li v-for="guild in state" :key="guild.guildId" class="state-card">
          <div class="row">
            <span class="label">Guild</span>
            <span class="value">{{ guild.guildId }}</span>
          </div>
          <div class="row">
            <span class="label">Channel</span>
            <span class="value">
              {{ guild.connectedChannelName ?? '—' }}
            </span>
          </div>
          <div class="row">
            <span class="label">Status</span>
            <span class="value">{{ guild.isIdle ? 'Idle' : 'Playing' }}</span>
          </div>
          <div class="row">
            <span class="label">Track</span>
            <span class="value">
              <template v-if="guild.track">
                {{ guild.track.name }}
                <small>({{ guild.track.category }})</small>
              </template>
              <template v-else>—</template>
            </span>
          </div>
        </li>
      </ul>
    </section>

    <PlayerControls />

    <div class="sound-grid">
      <SoundList title="Music" type="music" />
      <SoundList title="Effects" type="effects" />
    </div>
  </main>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding: 2rem;
}

.panel {
  width: 100%;
  background: var(--color-background-soft);
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 10px 40px rgba(15, 23, 42, 0.15);
}

.sound-grid {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

button {
  border: none;
  border-radius: 999px;
  padding: 0.4rem 1.25rem;
  background: var(--color-primary, #646cff);
  color: white;
  cursor: pointer;
}

button:disabled {
  opacity: 0.6;
  cursor: progress;
}

.state-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 1rem;
}

.state-card {
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 1rem;
  background: var(--color-background);
}

.row {
  display: flex;
  justify-content: space-between;
  font-size: 0.95rem;
  margin-bottom: 0.4rem;
}

.label {
  font-weight: 600;
  color: var(--color-text-soft);
}

.value {
  font-weight: 500;
}

.error {
  color: #f87171;
}
</style>
