<script setup lang="ts">
import { ref } from 'vue'
import {
  joinChannel,
  leaveGuild,
  playTrack,
  stopPlayback,
  triggerEffect,
} from '@/api/player'

const guildId = ref('')
const channelId = ref('')
const trackId = ref('')
const effectId = ref('')
const busy = ref(false)
const message = ref<string | null>(null)

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
      throw new Error('Guild + channel required')
    }
    return joinChannel(guildId.value, channelId.value)
  })

const onLeave = () =>
  run(() => {
    if (!guildId.value) throw new Error('Guild required')
    return leaveGuild(guildId.value)
  })

const onStop = () =>
  run(() => {
    if (!guildId.value) throw new Error('Guild required')
    return stopPlayback(guildId.value)
  })

const onPlay = () =>
  run(() => {
    if (!guildId.value || !trackId.value)
      throw new Error('Guild + track required')
    return playTrack({ guildId: guildId.value, trackId: trackId.value, channelId: channelId.value || undefined })
  })

const onEffect = () =>
  run(() => {
    if (!guildId.value || !effectId.value)
      throw new Error('Guild + effect required')
    return triggerEffect({ guildId: guildId.value, effectId: effectId.value, channelId: channelId.value || undefined })
  })
</script>

<template>
  <section class="control-panel">
    <header>
      <h2>Playback controls</h2>
      <span v-if="message">{{ message }}</span>
    </header>

    <div class="grid">
      <label>
        Guild ID
        <input v-model="guildId" placeholder="123…" />
      </label>
      <label>
        Channel ID (optional for play/effect)
        <input v-model="channelId" placeholder="456…" />
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

.grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

label {
  display: flex;
  flex-direction: column;
  font-size: 0.9rem;
  gap: 0.3rem;
}

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
</style>
