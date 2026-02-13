<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { GuildDirectoryEntry } from '@/api/player'
import {
  fetchGuildDirectory,
  joinChannel,
  leaveGuild,
  playTrack,
  stopPlayback,
  triggerEffect,
} from '@/api/player'

const directory = ref<GuildDirectoryEntry[]>([])
const directoryError = ref<string | null>(null)
const directoryLoading = ref(false)

const guildId = ref('')
const channelId = ref('')
const trackId = ref('')
const effectId = ref('')
const busy = ref(false)
const message = ref<string | null>(null)

const channels = computed(() => {
  const guild = directory.value.find((entry) => entry.guildId === guildId.value)
  return guild?.channels ?? []
})

function ensureChannelSelection() {
  if (!channels.value.length) {
    channelId.value = ''
    return
  }
  if (!channels.value.some((channel) => channel.id === channelId.value)) {
    channelId.value = channels.value[0]?.id ?? ''
  }
}

async function loadDirectory() {
  directoryLoading.value = true
  directoryError.value = null
  try {
    const data = await fetchGuildDirectory()
    directory.value = data
    ensureChannelSelection()
  } catch (err) {
    directoryError.value =
      err instanceof Error ? err.message : 'Failed to load guilds'
  } finally {
    directoryLoading.value = false
  }
}

async function run(action: () => Promise<unknown>) {
  busy.value = true
  message.value = null
  try {
    await action()
    message.value = 'Done'
  } catch (err) {
    message.value = err instanceof Error ? err.message : 'Action failed'
  } finally {
    busy.value = false
  }
}

const onJoin = () =>
  run(() => {
    if (!guildId.value || !channelId.value) {
      throw new Error('Select a guild + channel')
    }
    return joinChannel(guildId.value, channelId.value)
  })

const onLeave = () =>
  run(() => {
    if (!guildId.value) throw new Error('Select a guild first')
    return leaveGuild(guildId.value)
  })

const onStop = () =>
  run(() => {
    if (!guildId.value) throw new Error('Select a guild first')
    return stopPlayback(guildId.value)
  })

const onPlay = () =>
  run(() => {
    if (!guildId.value || !trackId.value)
      throw new Error('Guild + track required')
    return playTrack({
      guildId: guildId.value,
      trackId: trackId.value,
      channelId: channelId.value || undefined,
    })
  })

const onEffect = () =>
  run(() => {
    if (!guildId.value || !effectId.value)
      throw new Error('Guild + effect required')
    return triggerEffect({
      guildId: guildId.value,
      effectId: effectId.value,
      channelId: channelId.value || undefined,
    })
  })

watch(guildId, () => {
  ensureChannelSelection()
})

onMounted(() => {
  loadDirectory()
})
</script>

<template>
  <section class="control-panel">
    <header>
      <div>
        <h2>Playback controls</h2>
        <p class="eyebrow">Target a guild + channel directly</p>
      </div>
      <div class="header-actions">
        <span v-if="message" class="message">{{ message }}</span>
        <button
          type="button"
          class="ghost"
          @click="loadDirectory"
          :disabled="directoryLoading"
        >
          {{ directoryLoading ? 'Refreshing…' : 'Reload guilds' }}
        </button>
      </div>
    </header>

    <p v-if="directoryError" class="error">{{ directoryError }}</p>

    <div class="grid">
      <label>
        Guild
        <select v-model="guildId" @change="ensureChannelSelection">
          <option disabled value="">Select a guild…</option>
          <option v-for="guild in directory" :key="guild.guildId" :value="guild.guildId">
            {{ guild.guildName }}
          </option>
        </select>
      </label>
      <label>
        Channel
        <select v-model="channelId">
          <option value="">(Use connected channel)</option>
          <option
            v-for="channel in channels"
            :key="channel.id"
            :value="channel.id"
          >
            {{ channel.name }}
          </option>
        </select>
      </label>
      <label>
        Track ID
        <input v-model="trackId" placeholder="music file id" />
      </label>
      <label>
        Effect ID
        <input v-model="effectId" placeholder="effect file id" />
      </label>
    </div>

    <div class="actions">
      <button type="button" :disabled="busy" @click="onJoin">Join</button>
      <button type="button" :disabled="busy" @click="onLeave">Leave</button>
      <button type="button" :disabled="busy" @click="onStop">Stop</button>
      <button type="button" :disabled="busy" @click="onPlay">Play track</button>
      <button type="button" :disabled="busy" @click="onEffect">Play effect</button>
    </div>
  </section>
</template>

<style scoped>
.control-panel {
  border: 1px solid var(--color-border);
  border-radius: 12px;
  padding: 1rem;
  background: var(--color-background);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

label {
  display: flex;
  flex-direction: column;
  font-size: 0.9rem;
  gap: 0.3rem;
}

select,
input {
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 0.4rem 0.6rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

button {
  border: none;
  border-radius: 10px;
  padding: 0.4rem 1rem;
  background: var(--color-primary, #646cff);
  color: white;
}

button.ghost {
  background: transparent;
  border: 1px solid var(--color-border);
  color: var(--color-text);
  border-radius: 999px;
}

.message {
  font-size: 0.85rem;
  color: var(--color-text-soft);
}

.error {
  color: #f87171;
}
</style>
