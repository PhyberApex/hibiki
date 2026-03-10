<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  fetchDiscordConfig,
  fetchStoragePath,
  selectStorageFolder,
  updateDiscordToken,
  updateStoragePath,
} from '@/api/config'
import { usePlayerStore } from '@/stores/player'

const player = usePlayerStore()
const discordConfig = ref<{ tokenConfigured: boolean } | null>(null)
const tokenInput = ref('')
const saving = ref(false)
const message = ref<{ type: 'success' | 'error', text: string } | null>(null)

const storagePath = ref<string | null>(null)
const savingStorage = ref(false)
const storageMessage = ref<{ type: 'success' | 'error', text: string } | null>(null)

async function load() {
  try {
    const [config, storage] = await Promise.all([
      fetchDiscordConfig(),
      fetchStoragePath().catch(() => ({ path: null })),
    ])
    discordConfig.value = config
    storagePath.value = storage.path
  }
  catch (e) {
    message.value = { type: 'error', text: e instanceof Error ? e.message : 'Failed to load' }
  }
}

async function saveToken() {
  const token = tokenInput.value.trim()
  if (!token) {
    message.value = { type: 'error', text: 'Enter a token to save.' }
    return
  }
  saving.value = true
  message.value = null
  try {
    await updateDiscordToken(token)
    discordConfig.value = { tokenConfigured: true }
    tokenInput.value = ''
    message.value = { type: 'success', text: 'Token saved. Connecting…' }
    await player.doReconnect()
    if (player.botStatus?.ready)
      message.value = { type: 'success', text: 'Token saved. Bot connected.' }
    else
      message.value = { type: 'success', text: 'Token saved. If the bot did not connect, click Connect below.' }
  }
  catch (e) {
    message.value = { type: 'error', text: e instanceof Error ? e.message : 'Failed to save' }
  }
  finally {
    saving.value = false
  }
}

async function connectBot() {
  message.value = null
  await player.doReconnect()
  if (player.botStatus?.ready)
    message.value = { type: 'success', text: 'Bot connected.' }
  else
    message.value = { type: 'error', text: 'Connection failed. Check the token and try again.' }
}

async function browseStorageFolder() {
  storageMessage.value = null
  try {
    const path = await selectStorageFolder()
    if (path) {
      savingStorage.value = true
      await updateStoragePath(path)
      storagePath.value = path
      storageMessage.value = { type: 'success', text: 'Storage path saved. Restart the app to use the new location.' }
    }
  }
  catch (e) {
    storageMessage.value = { type: 'error', text: e instanceof Error ? e.message : 'Failed to set path' }
  }
  finally {
    savingStorage.value = false
  }
}

async function clearStoragePath() {
  storageMessage.value = null
  savingStorage.value = true
  try {
    await updateStoragePath('')
    storagePath.value = null
    storageMessage.value = { type: 'success', text: 'Using default storage. Restart the app to apply.' }
  }
  catch (e) {
    storageMessage.value = { type: 'error', text: e instanceof Error ? e.message : 'Failed to clear' }
  }
  finally {
    savingStorage.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="settings">
    <h1>Settings</h1>
    <section class="panel">
      <h2>Discord bot</h2>
      <p v-if="discordConfig" class="status">
        <span v-if="discordConfig.tokenConfigured && player.botStatus?.ready">
          Connected as <strong>{{ player.botStatus.userTag }}</strong>
        </span>
        <span v-else-if="discordConfig.tokenConfigured" class="status-row">
          Token is set but the bot is not connected.
          <button
            type="button"
            class="btn btn-inline"
            :disabled="player.reconnecting"
            @click="connectBot"
          >
            {{ player.reconnecting ? 'Connecting…' : 'Connect' }}
          </button>
        </span>
        <span v-else>
          No token configured. Set your Discord bot token below.
        </span>
      </p>
      <div class="form-row">
        <label for="token">Bot token</label>
        <input
          id="token"
          v-model="tokenInput"
          type="password"
          placeholder="Paste your Discord bot token"
          autocomplete="off"
          class="input"
        >
      </div>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="saving || !tokenInput.trim()"
        @click="saveToken"
      >
        {{ saving ? 'Saving…' : 'Save token' }}
      </button>
      <p v-if="message" class="message" :class="[message.type]">
        {{ message.text }}
      </p>
    </section>

    <section class="panel">
      <h2>Storage location</h2>
      <p class="status">
        Sound files (music, effects, ambience) are stored in a folder. By default this is inside the app data directory. You can choose a custom folder (e.g. on an external drive).
      </p>
      <div class="form-row">
        <label for="storage-path">Current path</label>
        <input
          id="storage-path"
          :value="storagePath ?? '(default: app data folder)'"
          type="text"
          readonly
          class="input input-readonly"
        >
      </div>
      <div class="form-actions">
        <button
          type="button"
          class="btn btn-primary"
          :disabled="savingStorage"
          @click="browseStorageFolder"
        >
          {{ savingStorage ? 'Saving…' : 'Choose folder' }}
        </button>
        <button
          v-if="storagePath"
          type="button"
          class="btn btn-ghost"
          :disabled="savingStorage"
          @click="clearStoragePath"
        >
          Use default
        </button>
      </div>
      <p v-if="storageMessage" class="message" :class="[storageMessage.type]">
        {{ storageMessage.text }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.settings {
  max-width: 32rem;
}
.panel {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: 1.5rem;
}
.panel + .panel {
  margin-top: 1.5rem;
}
.panel h2 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text);
}
.status {
  margin: 0 0 1rem;
  font-size: 0.9rem;
  color: var(--color-text-muted);
}
.status-row {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.btn-inline {
  padding: 0.2rem 0.5rem;
  font-size: 0.85rem;
  background: var(--color-accent);
  color: var(--color-bg);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.btn-inline:hover:not(:disabled) {
  opacity: 0.9;
}
.btn-inline:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
.form-row {
  margin-bottom: 1rem;
}
.form-row label {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text);
}
.input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  font-size: 0.9rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: var(--color-text);
}
.input-readonly {
  color: var(--color-text-muted);
  cursor: default;
}
.form-actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}
.btn-ghost {
  background: transparent;
  color: var(--color-text-muted);
}
.btn-ghost:hover:not(:disabled) {
  color: var(--color-text);
}
.btn {
  padding: 0.5rem 1rem;
  font-size: 0.9rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
  border: none;
}
.btn-primary {
  background: var(--color-accent);
  color: var(--color-bg);
}
.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.message {
  margin-top: 1rem;
  font-size: 0.875rem;
}
.message.success {
  color: var(--color-success, green);
}
.message.error {
  color: var(--color-error, #c00);
}
</style>
