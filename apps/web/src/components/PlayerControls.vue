<script setup lang="ts">
import type { GuildDirectoryEntry, PlayerStateItem } from '@/api/player'

import type { SoundFile } from '@/api/sounds'
import { computed, onMounted, ref, watch } from 'vue'
import {
  fetchGuildDirectory,
  joinChannel,
  leaveGuild,
  playTrack,
  stopPlayback,
  triggerEffect,
} from '@/api/player'
import { listEffects, listMusic } from '@/api/sounds'

const props = withDefaults(
  defineProps<{ playerState?: PlayerStateItem[], soundsVersion?: number }>(),
  { playerState: () => [], soundsVersion: 0 },
)
const emit = defineEmits<{ actionDone: [] }>()

const directory = ref<GuildDirectoryEntry[]>([])
const directoryError = ref<string | null>(null)
const directoryLoading = ref(false)

const musicTracks = ref<SoundFile[]>([])
const effectsList = ref<SoundFile[]>([])
const soundsLoading = ref(false)

const guildId = ref('')
const channelId = ref('')
const trackId = ref('')
const effectId = ref('')
const busy = ref(false)

type ToastType = 'success' | 'error'
const toast = ref<{ type: ToastType, text: string } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(type: ToastType, text: string) {
  if (toastTimer)
    clearTimeout(toastTimer)
  toast.value = { type, text }
  toastTimer = setTimeout(() => {
    toast.value = null
    toastTimer = null
  }, 4500)
}

const channels = computed(() => {
  const guild = directory.value.find(entry => entry.guildId === guildId.value)
  return guild?.channels ?? []
})

const selectedGuildState = computed(() =>
  props.playerState.find(g => g.guildId === guildId.value),
)
const isJoined = computed(() => !!selectedGuildState.value?.connectedChannelId)
const isPlaying = computed(() => isJoined.value && !selectedGuildState.value?.isIdle)

const canJoin = computed(
  () => !busy.value && !!guildId.value && !!channelId.value && !isJoined.value,
)
const canLeave = computed(() => !busy.value && !!guildId.value && isJoined.value)
const canStop = computed(() => !busy.value && !!guildId.value && isPlaying.value)
const canPlay = computed(
  () => !busy.value && !!guildId.value && !!trackId.value,
)
const canEffect = computed(
  () => !busy.value && !!guildId.value && !!effectId.value,
)

function ensureChannelSelection() {
  if (!channels.value.length) {
    channelId.value = ''
    return
  }
  if (!channels.value.some(channel => channel.id === channelId.value)) {
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
  }
  catch (err) {
    directoryError.value
      = err instanceof Error ? err.message : 'Failed to load guilds'
  }
  finally {
    directoryLoading.value = false
  }
}

async function loadSounds() {
  soundsLoading.value = true
  try {
    const [music, effects] = await Promise.all([
      listMusic(),
      listEffects(),
    ])
    musicTracks.value = music
    effectsList.value = effects
  }
  finally {
    soundsLoading.value = false
  }
}

async function run(
  action: () => Promise<unknown>,
  successMessage: string = 'Done',
) {
  busy.value = true
  toast.value = null
  try {
    await action()
    showToast('success', successMessage)
    emit('actionDone')
  }
  catch (err) {
    showToast('error', err instanceof Error ? err.message : 'Action failed')
  }
  finally {
    busy.value = false
  }
}

function onJoin() {
  return run(() => {
    if (!guildId.value || !channelId.value) {
      throw new Error('Select a guild + channel')
    }
    return joinChannel(guildId.value, channelId.value)
  }, 'Joined voice channel')
}

function onLeave() {
  return run(() => {
    if (!guildId.value)
      throw new Error('Select a guild first')
    return leaveGuild(guildId.value)
  }, 'Left voice channel')
}

function onStop() {
  return run(() => {
    if (!guildId.value)
      throw new Error('Select a guild first')
    return stopPlayback(guildId.value)
  }, 'Playback stopped')
}

function onPlay() {
  return run(() => {
    if (!guildId.value || !trackId.value)
      throw new Error('Select a guild and a track')
    return playTrack({
      guildId: guildId.value,
      trackId: trackId.value,
      channelId: channelId.value || undefined,
    })
  }, 'Playing track')
}

function onEffect() {
  return run(() => {
    if (!guildId.value || !effectId.value)
      throw new Error('Select a guild and an effect')
    return triggerEffect({
      guildId: guildId.value,
      effectId: effectId.value,
      channelId: channelId.value || undefined,
    })
  }, 'Effect triggered')
}

watch(guildId, () => {
  ensureChannelSelection()
})

watch(() => props.soundsVersion, () => {
  loadSounds()
})

onMounted(() => {
  loadDirectory()
  loadSounds()
})
</script>

<template>
  <section class="control-panel">
    <header class="panel-header">
      <div>
        <p class="eyebrow">
          Actions
        </p>
        <h2>Playback controls</h2>
      </div>
      <div class="header-actions">
        <Transition name="toast">
          <div
            v-if="toast"
            class="toast" :class="[toast.type === 'success' ? 'toast-success' : 'toast-error']"
            role="alert"
          >
            {{ toast.text }}
          </div>
        </Transition>
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="directoryLoading"
          @click="loadDirectory"
        >
          {{ directoryLoading ? 'Refreshing…' : 'Reload guilds' }}
        </button>
      </div>
    </header>

    <p v-if="directoryError" class="control-error">
      {{ directoryError }}
    </p>

    <div class="control-grid">
      <label class="field">
        <span class="field-label">Guild</span>
        <select v-model="guildId" class="field-input" @change="ensureChannelSelection">
          <option disabled value="">Select a guild…</option>
          <option v-for="guild in directory" :key="guild.guildId" :value="guild.guildId">
            {{ guild.guildName }}
          </option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">Channel</span>
        <select v-model="channelId" class="field-input">
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
      <label class="field">
        <span class="field-label">Track</span>
        <select v-model="trackId" class="field-input" :disabled="soundsLoading">
          <option value="">Select a track…</option>
          <option
            v-for="track in musicTracks"
            :key="track.id"
            :value="track.id"
          >
            {{ track.name }}
          </option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">Effect</span>
        <select v-model="effectId" class="field-input" :disabled="soundsLoading">
          <option value="">Select an effect…</option>
          <option
            v-for="effect in effectsList"
            :key="effect.id"
            :value="effect.id"
          >
            {{ effect.name }}
          </option>
        </select>
      </label>
    </div>

    <div class="actions">
      <button type="button" class="btn btn-primary" :disabled="!canJoin" @click="onJoin">
        Join
      </button>
      <button type="button" class="btn btn-secondary" :disabled="!canLeave" @click="onLeave">
        Leave
      </button>
      <button type="button" class="btn btn-secondary" :disabled="!canStop" @click="onStop">
        Stop
      </button>
      <button type="button" class="btn btn-primary" :disabled="!canPlay" @click="onPlay">
        Play
      </button>
      <button type="button" class="btn btn-secondary" :disabled="!canEffect" @click="onEffect">
        Effect
      </button>
    </div>
  </section>
</template>

<style scoped>
.control-panel {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: 1.5rem;
  box-shadow: var(--shadow-card);
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.panel-header {
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

.panel-header h2 {
  margin: 0.2rem 0 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  position: relative;
}

.toast {
  position: absolute;
  right: 0;
  top: 0;
  padding: 0.5rem 1rem;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  font-weight: 500;
  box-shadow: var(--shadow-card);
}

.toast-success {
  background: var(--color-success);
  color: #fff;
}

.toast-error {
  background: var(--color-error);
  color: #fff;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.control-error {
  margin: 0;
  font-size: 0.9rem;
  color: var(--color-error);
}

.btn {
  border: none;
  border-radius: var(--radius-md);
  padding: 0.5rem 1rem;
  font-size: 0.9rem;
  font-weight: 500;
  transition: background var(--transition), opacity var(--transition);
}

.btn-primary {
  background: var(--color-accent);
  color: #0c0c0e;
}
.btn-primary:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-secondary {
  background: var(--color-bg-elevated);
  color: var(--color-text);
  border: 1px solid var(--color-border);
}
.btn-secondary:hover:not(:disabled) {
  background: var(--color-border);
}

.btn-ghost {
  background: transparent;
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
}
.btn-ghost:hover:not(:disabled) {
  background: var(--color-bg-elevated);
  color: var(--color-text);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.control-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.field-label {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-muted);
}

.field-input {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.75rem;
  color: var(--color-text);
  transition: border-color var(--transition);
}
.field-input:focus {
  outline: none;
  border-color: var(--color-border-focus);
}
.field-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
</style>
