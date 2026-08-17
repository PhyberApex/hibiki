<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  fetchDiscordConfig,
  fetchStoragePath,
  selectStorageFolder,
  updateDiscordToken,
  updateStoragePath,
} from '@/api/config'
import { useAccessibilityStore } from '@/stores/accessibility'
import { usePlayerStore } from '@/stores/player'

const player = usePlayerStore()
const accessibility = useAccessibilityStore()
const discordConfig = ref<{ tokenConfigured: boolean } | null>(null)
const tokenInput = ref('')
const saving = ref(false)
const message = ref<{ type: 'success' | 'error', text: string } | null>(null)

const storagePath = ref<string | null>(null)
const savingStorage = ref(false)
const storageMessage = ref<{ type: 'success' | 'error', text: string } | null>(null)

const accessibilityMessage = ref<{ type: 'success' | 'error', text: string } | null>(null)

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
    message.value = { type: 'error', text: e instanceof Error ? e.message : 'Couldn\'t load settings. Try again.' }
  }
}

async function saveToken() {
  const token = tokenInput.value.trim()
  if (!token) {
    message.value = { type: 'error', text: 'Paste your Discord bot token in the field below first.' }
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
      message.value = { type: 'success', text: 'Token saved. Bot didn\'t connect — click Connect below to try again.' }
  }
  catch (e) {
    message.value = { type: 'error', text: e instanceof Error ? e.message : 'Couldn\'t save token. Copy the full token from the Discord Developer Portal and try again.' }
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
    message.value = { type: 'error', text: 'Could not connect. Double-check your token and try again.' }
}

async function browseStorageFolder() {
  storageMessage.value = null
  try {
    const path = await selectStorageFolder()
    if (path) {
      savingStorage.value = true
      await updateStoragePath(path)
      storagePath.value = path
      storageMessage.value = { type: 'success', text: 'Storage folder set. Restart Hibiki to use the new location.' }
    }
  }
  catch (e) {
    storageMessage.value = { type: 'error', text: e instanceof Error ? e.message : 'Could not set storage folder.' }
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
    storageMessage.value = { type: 'success', text: 'Reverted to default storage. Restart Hibiki to apply.' }
  }
  catch (e) {
    storageMessage.value = { type: 'error', text: e instanceof Error ? e.message : 'Could not reset storage folder.' }
  }
  finally {
    savingStorage.value = false
  }
}

async function persistAccessibility(update: () => Promise<void>) {
  accessibilityMessage.value = null
  try {
    await update()
  }
  catch (e) {
    accessibilityMessage.value = { type: 'error', text: e instanceof Error ? e.message : 'Could not save accessibility settings.' }
  }
}

function onLuminancePulsesChange(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  persistAccessibility(() => accessibility.setLuminancePulses(enabled))
}

function onReduceMotionChange(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  persistAccessibility(() => accessibility.setReduceMotion(enabled))
}

function useSystemMotion() {
  persistAccessibility(() => accessibility.setReduceMotion(null))
}

onMounted(load)
</script>

<template>
  <div class="settings">
    <h1 class="page-title">
      Settings
    </h1>

    <section class="section">
      <div class="section-header">
        <h2 class="section-title">
          Discord bot
        </h2>
        <p v-if="discordConfig" class="section-status">
          <span v-if="discordConfig.tokenConfigured && player.botStatus?.ready" class="status-connected">
            Connected as <strong>{{ player.botStatus.userTag }}</strong>
          </span>
          <span v-else-if="discordConfig.tokenConfigured" class="status-row">
            Token saved, not connected.
            <button
              type="button"
              class="btn btn-inline"
              :disabled="player.reconnecting"
              @click="connectBot"
            >
              {{ player.reconnecting ? 'Connecting…' : 'Connect' }}
            </button>
          </span>
          <span v-else class="status-missing">
            No token yet
          </span>
        </p>
      </div>
      <p class="section-desc">
        <template v-if="!discordConfig?.tokenConfigured">
          Create a bot in the
          <a
            href="https://discord.com/developers/applications"
            target="_blank"
            rel="noopener"
            class="settings-link"
          >Discord Developer Portal</a>, copy its token, and paste it below.
        </template>
        <template v-else>
          Replace the token if you need to switch bots or regenerated your token.
        </template>
      </p>
      <div class="field">
        <label for="token" class="field-label">Bot token</label>
        <div class="field-row">
          <input
            id="token"
            v-model="tokenInput"
            type="password"
            placeholder="Paste token from Discord Developer Portal"
            autocomplete="off"
            class="input field-input"
          >
          <button
            type="button"
            class="btn btn-primary"
            :disabled="saving || !tokenInput.trim()"
            @click="saveToken"
          >
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </div>
      <p
        v-if="message"
        class="status-message settings-message"
        :class="[message.type === 'success' ? 'status-message-success' : 'status-message-error']"
      >
        {{ message.text }}
      </p>
    </section>

    <hr class="divider">

    <section class="section">
      <div class="section-header">
        <h2 class="section-title">
          Storage location
        </h2>
      </div>
      <p class="section-desc">
        Sound files are stored locally. By default they live in the app data folder. Pick a custom location if you want to use an external drive or shared folder.
      </p>
      <div class="field">
        <label for="storage-path" class="field-label">Current path</label>
        <div class="field-row">
          <input
            id="storage-path"
            :value="storagePath ?? '(default: app data folder)'"
            type="text"
            readonly
            class="input field-input input-readonly"
          >
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
            Reset
          </button>
        </div>
      </div>
      <p
        v-if="storageMessage"
        class="status-message settings-message"
        :class="[storageMessage.type === 'success' ? 'status-message-success' : 'status-message-error']"
      >
        {{ storageMessage.text }}
      </p>
    </section>

    <hr class="divider">

    <section class="section">
      <div class="section-header">
        <h2 class="section-title">
          Accessibility
        </h2>
      </div>
      <p class="section-desc">
        Status indicators glow in rhythm so you can catch changes from the corner of your eye — a slow breath while ambience loops, a sharp pulse when disconnected, a flash when an effect fires.
      </p>
      <div class="toggle-list">
        <div class="toggle-row">
          <input
            id="luminance-pulses"
            type="checkbox"
            class="toggle-input"
            :checked="accessibility.luminancePulses"
            @change="onLuminancePulsesChange"
          >
          <div class="toggle-text">
            <label for="luminance-pulses" class="toggle-title">Status pulses</label>
            <span class="toggle-desc">Turn off to show status with color only — no glow or rhythm.</span>
          </div>
        </div>
        <div class="toggle-row">
          <input
            id="reduce-motion"
            type="checkbox"
            class="toggle-input"
            :checked="accessibility.reduceMotion"
            @change="onReduceMotionChange"
          >
          <div class="toggle-text">
            <label for="reduce-motion" class="toggle-title">Reduce motion</label>
            <span class="toggle-desc">Stops pulses and other animations throughout the app.</span>
            <span class="toggle-desc motion-source">
              <template v-if="accessibility.followsSystemMotion">
                Following your system preference ({{ accessibility.systemReducesMotion ? 'on' : 'off' }}).
              </template>
              <template v-else>
                Overriding your system preference.
                <button type="button" class="btn-motion-reset" @click="useSystemMotion">
                  Use system setting
                </button>
              </template>
            </span>
          </div>
        </div>
      </div>
      <p
        v-if="accessibilityMessage"
        class="status-message settings-message"
        :class="[accessibilityMessage.type === 'success' ? 'status-message-success' : 'status-message-error']"
      >
        {{ accessibilityMessage.text }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.settings {
  max-width: 40rem;
}

/* ── Page title ── */

.page-title {
  margin: 0 0 2rem;
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

/* ── Sections ── */

.section {
  padding: 0;
}

.section-header {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 0.25rem;
}

.section-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text);
}

.section-desc {
  margin: 0 0 1.25rem;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.section-status {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.status-connected {
  color: var(--color-success);
}

.status-missing {
  color: var(--color-text-dim);
}

.status-row {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.divider {
  border: none;
  border-top: 1px solid var(--color-border);
  margin: 1.75rem 0;
}

/* ── Fields ── */

.field {
  margin-bottom: 0;
}

.field-label {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--color-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.field-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.field-input {
  flex: 1;
  min-width: 0;
}

.input-readonly {
  color: var(--color-text-muted);
  cursor: default;
}

/* ── Toggles ── */

.toggle-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.toggle-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem 0.85rem;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  transition: border-color var(--transition);
}

.toggle-row:hover {
  border-color: var(--color-border-focus);
}

.toggle-input {
  margin: 0.2rem 0 0;
  accent-color: var(--color-accent);
  flex-shrink: 0;
}

.toggle-text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.toggle-title {
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--color-text);
  cursor: pointer;
}

.toggle-desc {
  font-size: 0.8rem;
  color: var(--color-text-muted);
  line-height: 1.45;
}

.btn-motion-reset {
  padding: 0;
  font-size: inherit;
  color: var(--color-accent);
  background: none;
  border: none;
  cursor: pointer;
}

.btn-motion-reset:hover {
  text-decoration: underline;
}

/* ── Buttons ── */

.btn-inline {
  padding: 0.3rem 0.6rem;
  font-size: 0.85rem;
  background: var(--color-accent);
  color: var(--color-accent-text);
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

/* ── Links ── */

.settings-link {
  color: var(--color-accent);
  text-decoration: none;
}

.settings-link:hover {
  text-decoration: underline;
}

/* ── Messages ── */

.settings-message {
  margin: 0.75rem 0 0;
}

/* ── Narrow ── */

@media (max-width: 560px) {
  .field-row {
    flex-direction: column;
    align-items: stretch;
  }

  .field-input {
    flex: none;
  }

  .section-header {
    flex-direction: column;
    gap: 0.25rem;
  }
}
</style>
