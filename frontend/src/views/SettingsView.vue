<script setup lang="ts">
import type { DiscordConfig, HotkeySettings, LocalOutputDevice, VisionConfig, VisionProviderId } from '@/api/config'
import type { HotkeyFailure } from '@/api/hotkeys'
import { computed, onActivated, onMounted, onUnmounted, ref } from 'vue'
import {
  clearDiscordToken,
  fetchDiscordConfig,
  fetchHotkeySettings,
  fetchLocalOutputDevice,
  fetchSceneFadeLength,
  fetchStoragePath,
  fetchVisionConfig,
  SCENE_FADE_LENGTH_MAX_SECONDS,
  SCENE_FADE_LENGTH_MIN_SECONDS,
  SCENE_FADE_LENGTH_STEP_SECONDS,
  selectStorageFolder,
  updateDiscordToken,
  updateHotkeySettings,
  updateLocalOutputDevice,
  updateSceneFadeLength,
  updateStoragePath,
  updateVisionApiKey,
  updateVisionEnabled,
  updateVisionOpenAiBaseUrl,
  updateVisionOpenAiModel,
  updateVisionProvider,
} from '@/api/config'
import { fetchHotkeyStatus } from '@/api/hotkeys'
import { fetchLogPath, openLogFolder } from '@/api/logs'
import { fetchUpdateCheckSettings, updateUpdateCheckEnabled } from '@/api/updates'
import { fetchUsageStats, updateUsageStatsEnabled } from '@/api/usage-stats'
import { logInfo } from '@/audio/audio-element-diagnostics'
import { listOutputDevices, outputDeviceRouter } from '@/audio/output-device'
import HotkeyRecorder from '@/components/HotkeyRecorder.vue'
import { useAccessibilityStore } from '@/stores/accessibility'
import { usePlayerStore } from '@/stores/player'
import { useScenePlaybackStore } from '@/stores/scene-playback'

const player = usePlayerStore()
const accessibility = useAccessibilityStore()
const discordConfig = ref<DiscordConfig | null>(null)
const tokenInput = ref('')
const saving = ref(false)
const removing = ref(false)
const message = ref<{ type: 'success' | 'error', text: string } | null>(null)

const storagePath = ref<string | null>(null)
const logPath = ref<string | null>(null)
const savingStorage = ref(false)
const storageMessage = ref<{ type: 'success' | 'error', text: string } | null>(null)

const accessibilityMessage = ref<{ type: 'success' | 'error', text: string } | null>(null)

const updateCheckEnabled = ref(true)
const savingUpdateCheck = ref(false)
const updateCheckMessage = ref<{ type: 'success' | 'error', text: string } | null>(null)

const usageStatsEnabled = ref(false)
const savingUsageStats = ref(false)
const usageStatsMessage = ref<{ type: 'success' | 'error', text: string } | null>(null)
const PRIVACY_PAGE_URL = 'https://phyberapex.github.io/hibiki/privacy'
// Mirrors the backend allowlist (src/usage-stats/allowlist.ts) and docs/privacy.md.
const USAGE_STATS_EVENTS = [
  { name: 'App start', sent: 'Operating system, processor architecture, Hibiki version, language' },
  { name: 'Scene played', sent: 'Music Mode, how many Music, Ambience and Effect items, Discord or Local' },
  { name: 'Output switched', sent: 'Discord or Local' },
  { name: 'Browser tab routed', sent: 'On or off, Discord or Local' },
  { name: 'Hotkey pressed', sent: 'Scene, Effect or Action Hotkey (never the key)' },
  { name: 'Vision to Vibe used', sent: 'Claude or OpenAI-compatible' },
  { name: 'Registry Scene installed', sent: 'The public Registry entry id' },
]

const sceneFadeLength = ref(3)
const savingFadeLength = ref(false)
const fadeLengthMessage = ref<{ type: 'success' | 'error', text: string } | null>(null)

const DEFAULT_VISION_CONFIG: VisionConfig = {
  provider: 'claude',
  enabled: false,
  configured: false,
  claude: { keyConfigured: false, configured: false, encrypted: true },
  openaiCompatible: {
    keyConfigured: false,
    configured: false,
    encrypted: true,
    baseUrl: '',
    model: '',
  },
}

const visionConfig = ref<VisionConfig | null>(null)
const visionKeyInput = ref('')
const visionBaseUrlInput = ref('')
const visionModelInput = ref('')
const savingVisionKey = ref(false)
const savingVisionProvider = ref(false)
const savingVisionAdvanced = ref(false)
const savingVisionToggle = ref(false)
const visionMessage = ref<{ type: 'success' | 'error', text: string } | null>(null)

const outputDevices = ref<{ deviceId: string, label: string }[]>([])
const outputDeviceChoice = ref<LocalOutputDevice | null>(null)
const outputDeviceMessage = ref<{ type: 'success' | 'error', text: string } | null>(null)

/** The stored device stays selected (and listed as absent) while it is unplugged. */
const absentOutputDevice = computed(() => {
  const choice = outputDeviceChoice.value
  return choice && !outputDevices.value.some(d => d.deviceId === choice.deviceId)
    ? choice
    : null
})

async function refreshOutputDevices() {
  try {
    outputDevices.value = listOutputDevices(await navigator.mediaDevices.enumerateDevices())
  }
  catch (e) {
    console.warn('[settings] Couldn\'t list output devices:', e)
  }
}

async function changeOutputDevice(event: Event) {
  const select = event.target as HTMLSelectElement
  const deviceId = select.value
  const next = deviceId === ''
    ? null
    : (deviceId === outputDeviceChoice.value?.deviceId
        ? outputDeviceChoice.value
        : { deviceId, label: outputDevices.value.find(d => d.deviceId === deviceId)?.label ?? '' })
  outputDeviceMessage.value = null
  try {
    await updateLocalOutputDevice(next)
    outputDeviceChoice.value = next
    outputDeviceRouter.setChoice(next)
  }
  catch (e) {
    console.warn('[settings] Output Device rejected:', e)
    select.value = outputDeviceChoice.value?.deviceId ?? ''
    outputDeviceMessage.value = {
      type: 'error',
      text: e instanceof Error
        ? e.message
        : 'Couldn\'t save the Output Device.',
    }
  }
}

const hotkeySettings = ref<HotkeySettings>({ enabled: true })
const hotkeyFailures = ref<HotkeyFailure[]>([])
const savingHotkeys = ref(false)
/** Action Hotkey rows, in display order; `field` is the key in the stored hotkey settings. */
const actionHotkeyRows = [
  { field: 'stopHotkey', label: 'Stop Scene' },
  { field: 'stopEffectsHotkey', label: 'Stop all Effects' },
  { field: 'previousSceneHotkey', label: 'Previous Scene' },
  { field: 'nextSceneHotkey', label: 'Next Scene' },
  { field: 'volumeDownHotkey', label: 'Volume Down' },
  { field: 'volumeUpHotkey', label: 'Volume Up' },
] as const
type ActionHotkeyField = typeof actionHotkeyRows[number]['field']
const actionHotkeyErrors = ref<Partial<Record<ActionHotkeyField, string>>>({})
const hotkeyMessage = ref<{ type: 'success' | 'error', text: string } | null>(null)

const isOpenAiCompatible = computed(() => visionConfig.value?.provider === 'openai-compatible')
const providerLabel = computed(() => isOpenAiCompatible.value ? 'OpenAI-compatible' : 'Anthropic')
const selectedProviderStatus = computed(() => {
  if (!visionConfig.value)
    return null
  return isOpenAiCompatible.value ? visionConfig.value.openaiCompatible : visionConfig.value.claude
})

function syncVisionAdvancedInputs() {
  visionBaseUrlInput.value = visionConfig.value?.openaiCompatible.baseUrl ?? ''
  visionModelInput.value = visionConfig.value?.openaiCompatible.model ?? ''
}

async function load() {
  try {
    const [config, storage, vision, fadeLength, logs, hotkeys, hotkeyStatus] = await Promise.all([
      fetchDiscordConfig(),
      fetchStoragePath().catch(() => ({ path: null })),
      fetchVisionConfig().catch(() => DEFAULT_VISION_CONFIG),
      fetchSceneFadeLength().catch(() => 3),
      fetchLogPath().catch(() => null),
      fetchHotkeySettings().catch((): HotkeySettings => ({ enabled: true })),
      fetchHotkeyStatus().catch(() => null),
    ])
    hotkeySettings.value = hotkeys
    hotkeyFailures.value = hotkeyStatus?.failures ?? []
    discordConfig.value = config
    storagePath.value = storage.path
    logPath.value = logs
    visionConfig.value = vision
    sceneFadeLength.value = fadeLength
    syncVisionAdvancedInputs()
  }
  catch (e) {
    message.value = {
      type: 'error',
      text: e instanceof Error
        ? e.message
        : 'Couldn\'t load settings. Try again.',
    }
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
    try {
      discordConfig.value = await updateDiscordToken(token)
    }
    catch (e) {
      console.warn('[settings] Discord token save failed:', e)
      message.value = {
        type: 'error',
        text: e instanceof Error
          ? e.message
          : 'Couldn\'t save token. Copy the full token from the Discord Developer Portal and try again.',
      }
      return
    }
    tokenInput.value = ''
    message.value = { type: 'success', text: 'Token saved. Connecting…' }
    try {
      await player.doReconnect()
    }
    catch (e) {
      console.warn('[settings] connect after saving the token failed:', e)
      message.value = { type: 'error', text: `Token saved, but the bot couldn't connect: ${connectFailureText(e)}` }
      return
    }
    if (player.botStatus?.ready)
      message.value = { type: 'success', text: 'Token saved. Bot connected.' }
    else
      message.value = { type: 'success', text: 'Token saved. Bot didn\'t connect — click Connect below to try again.' }
  }
  finally {
    saving.value = false
  }
}

function connectFailureText(e: unknown) {
  return e instanceof Error && e.message
    ? e.message
    : 'Double-check your token and try again.'
}

async function removeToken() {
  // eslint-disable-next-line no-alert -- simple confirm for destructive action
  if (!confirm('Remove the Discord bot token? The bot goes offline, and you will need to paste the token again to use Discord.'))
    return
  removing.value = true
  message.value = null
  try {
    // Stop the renderer's side of a Scene playing on Discord while its voice connection still exists.
    if (!player.isLocalActive)
      useScenePlaybackStore().stopScene()
    discordConfig.value = await clearDiscordToken()
    await player.resetAfterDiscordTokenRemoved()
    logInfo('[settings] Discord token removed')
    message.value = { type: 'success', text: 'Token removed. The bot is offline; playback now uses this computer.' }
  }
  catch (e) {
    console.error('[settings] Could not remove the Discord token:', e)
    message.value = {
      type: 'error',
      text: e instanceof Error
        ? e.message
        : 'Couldn\'t remove the token. Try again.',
    }
  }
  finally {
    removing.value = false
  }
}

async function connectBot() {
  message.value = null
  try {
    await player.doReconnect()
  }
  catch (e) {
    console.warn('[settings] connect failed:', e)
    message.value = { type: 'error', text: `Could not connect: ${connectFailureText(e)}` }
    return
  }
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
    storageMessage.value = {
      type: 'error',
      text: e instanceof Error
        ? e.message
        : 'Could not set storage folder.',
    }
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
    storageMessage.value = {
      type: 'error',
      text: e instanceof Error
        ? e.message
        : 'Could not reset storage folder.',
    }
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
    accessibilityMessage.value = {
      type: 'error',
      text: e instanceof Error
        ? e.message
        : 'Could not save accessibility settings.',
    }
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

async function onSceneFadeLengthChange(event: Event) {
  const input = event.target as HTMLInputElement
  const seconds = Number(input.value)
  const previous = sceneFadeLength.value
  sceneFadeLength.value = seconds
  savingFadeLength.value = true
  fadeLengthMessage.value = null
  try {
    await updateSceneFadeLength(seconds)
  }
  catch (e) {
    console.warn('[settings] Scene fade length rejected:', e)
    sceneFadeLength.value = previous
    input.value = String(previous)
    fadeLengthMessage.value = {
      type: 'error',
      text: e instanceof Error
        ? e.message
        : 'Couldn\'t save fade length.',
    }
  }
  finally {
    savingFadeLength.value = false
  }
}

async function changeVisionProvider(event: Event) {
  const provider = (event.target as HTMLSelectElement).value as VisionProviderId
  savingVisionProvider.value = true
  visionMessage.value = null
  try {
    visionConfig.value = await updateVisionProvider(provider)
    syncVisionAdvancedInputs()
  }
  catch (e) {
    visionMessage.value = {
      type: 'error',
      text: e instanceof Error
        ? e.message
        : 'Couldn\'t switch the Vision Provider.',
    }
  }
  finally {
    savingVisionProvider.value = false
  }
}

async function saveVisionKey() {
  const apiKey = visionKeyInput.value.trim()
  if (!apiKey || !visionConfig.value) {
    visionMessage.value = { type: 'error', text: `Paste your ${providerLabel.value} API key in the field first.` }
    return
  }
  savingVisionKey.value = true
  visionMessage.value = null
  try {
    visionConfig.value = await updateVisionApiKey(visionConfig.value.provider, apiKey)
    visionKeyInput.value = ''
    visionMessage.value = { type: 'success', text: 'Key saved. Switch Vision to Vibe on below to start using it.' }
  }
  catch (e) {
    visionMessage.value = {
      type: 'error',
      text: e instanceof Error
        ? e.message
        : 'Couldn\'t save the API key.',
    }
  }
  finally {
    savingVisionKey.value = false
  }
}

async function clearVisionKey() {
  if (!visionConfig.value)
    return
  const provider = visionConfig.value.provider
  const envVar = provider === 'openai-compatible'
    ? 'HIBIKI_VISION_OPENAI_API_KEY'
    : 'HIBIKI_VISION_API_KEY'
  savingVisionKey.value = true
  visionMessage.value = null
  try {
    visionConfig.value = await updateVisionApiKey(provider, '')
    const status = provider === 'openai-compatible'
      ? visionConfig.value.openaiCompatible
      : visionConfig.value.claude
    if (status.keyConfigured) {
      visionMessage.value = { type: 'success', text: `Stored key removed. The key from the ${envVar} environment variable is still in use.` }
      return
    }
    if (!visionConfig.value.configured && visionConfig.value.enabled)
      visionConfig.value = await updateVisionEnabled(false)
    visionMessage.value = {
      type: 'success',
      text: visionConfig.value.enabled ? 'Key removed.' : 'Key removed. Vision to Vibe is off.',
    }
  }
  catch (e) {
    visionMessage.value = {
      type: 'error',
      text: e instanceof Error
        ? e.message
        : 'Couldn\'t remove the API key.',
    }
  }
  finally {
    savingVisionKey.value = false
  }
}

async function saveVisionAdvancedField(
  label: string,
  value: string,
  update: (value: string) => Promise<VisionConfig>,
) {
  savingVisionAdvanced.value = true
  visionMessage.value = null
  try {
    visionConfig.value = await update(value)
    syncVisionAdvancedInputs()
    visionMessage.value = {
      type: 'success',
      text: value
        ? `${label} saved.`
        : `${label} reset to the default.`,
    }
  }
  catch (e) {
    const action = value ? 'save' : 'reset'
    visionMessage.value = {
      type: 'error',
      text: e instanceof Error
        ? e.message
        : `Couldn't ${action} the ${label}.`,
    }
  }
  finally {
    savingVisionAdvanced.value = false
  }
}

const saveVisionBaseUrl = () => saveVisionAdvancedField('Base URL', visionBaseUrlInput.value, updateVisionOpenAiBaseUrl)
const resetVisionBaseUrl = () => saveVisionAdvancedField('Base URL', '', updateVisionOpenAiBaseUrl)
const saveVisionModel = () => saveVisionAdvancedField('Model', visionModelInput.value, updateVisionOpenAiModel)
const resetVisionModel = () => saveVisionAdvancedField('Model', '', updateVisionOpenAiModel)

async function toggleVision(event: Event) {
  const input = event.target as HTMLInputElement
  const enabled = input.checked
  savingVisionToggle.value = true
  visionMessage.value = null
  try {
    visionConfig.value = await updateVisionEnabled(enabled)
    visionMessage.value = {
      type: 'success',
      text: enabled ? 'Vision to Vibe is on. Look for it in the scene editor.' : 'Vision to Vibe is off.',
    }
  }
  catch (e) {
    console.warn('[settings] Vision to Vibe toggle rejected:', e)
    input.checked = Boolean(visionConfig.value?.enabled)
    visionMessage.value = {
      type: 'error',
      text: e instanceof Error
        ? e.message
        : 'Couldn\'t update Vision to Vibe.',
    }
  }
  finally {
    savingVisionToggle.value = false
  }
}

async function saveHotkeySettings(next: HotkeySettings) {
  savingHotkeys.value = true
  actionHotkeyErrors.value = {}
  hotkeyMessage.value = null
  try {
    await updateHotkeySettings(next)
    hotkeySettings.value = next
    await refreshHotkeyFailures()
  }
  catch (e) {
    console.warn('[settings] Hotkey settings rejected:', e)
    const text = e instanceof Error
      ? e.message
      : 'Couldn\'t save hotkey settings.'
    const changed = actionHotkeyRows.find(row => next[row.field] !== hotkeySettings.value[row.field])
    if (changed)
      actionHotkeyErrors.value = { [changed.field]: text }
    else
      hotkeyMessage.value = { type: 'error', text }
  }
  finally {
    savingHotkeys.value = false
  }
}

/** Keeps the last list on a failed fetch, so a flaky status call does not hide known refusals. */
async function refreshHotkeyFailures() {
  try {
    hotkeyFailures.value = (await fetchHotkeyStatus()).failures
  }
  catch (e) {
    console.warn('[settings] Couldn\'t refresh the hotkey status:', e)
  }
}

async function toggleHotkeys(event: Event) {
  const input = event.target as HTMLInputElement
  await saveHotkeySettings({ ...hotkeySettings.value, enabled: input.checked })
  // Vue does not re-patch an unchanged :checked, so a rejected save must restore the box itself.
  input.checked = hotkeySettings.value.enabled
}

async function toggleUpdateCheck(event: Event) {
  const input = event.target as HTMLInputElement
  const enabled = input.checked
  savingUpdateCheck.value = true
  updateCheckMessage.value = null
  try {
    await updateUpdateCheckEnabled(enabled)
    updateCheckEnabled.value = enabled
  }
  catch (e) {
    input.checked = updateCheckEnabled.value
    updateCheckMessage.value = {
      type: 'error',
      text: e instanceof Error
        ? e.message
        : 'Could not save the update check setting.',
    }
  }
  finally {
    savingUpdateCheck.value = false
  }
}

async function toggleUsageStats(event: Event) {
  const input = event.target as HTMLInputElement
  const enabled = input.checked
  savingUsageStats.value = true
  usageStatsMessage.value = null
  try {
    usageStatsEnabled.value = (await updateUsageStatsEnabled(enabled)).enabled
  }
  catch (e) {
    input.checked = usageStatsEnabled.value
    usageStatsMessage.value = {
      type: 'error',
      text: e instanceof Error
        ? e.message
        : 'Could not save the Usage Stats setting.',
    }
  }
  finally {
    savingUsageStats.value = false
  }
}

function setActionHotkey(field: ActionHotkeyField, value: string | undefined) {
  const { [field]: _previous, ...rest } = hotkeySettings.value
  return saveHotkeySettings(value
    ? { ...rest, [field]: value }
    : rest)
}

onMounted(() => {
  void load()
  void fetchLocalOutputDevice().then((choice) => {
    outputDeviceChoice.value = choice
  }).catch(() => {})
  void refreshOutputDevices()
  void fetchUpdateCheckSettings().then(({ enabled }) => {
    updateCheckEnabled.value = enabled
  }).catch(e => console.error('[settings] Could not load the update check setting:', e))
  void fetchUsageStats().then(({ enabled }) => {
    usageStatsEnabled.value = enabled
  }).catch(e => console.error('[settings] Could not load the Usage Stats setting:', e))
  navigator.mediaDevices?.addEventListener?.('devicechange', refreshOutputDevices)
})
// Settings stays alive under KeepAlive: a Scene or Effect Hotkey bound since the last visit may have been refused.
onActivated(() => {
  void refreshHotkeyFailures()
})
onUnmounted(() => navigator.mediaDevices?.removeEventListener?.('devicechange', refreshOutputDevices))
</script>

<template>
  <div class="settings">
    <h1 class="page-title">
      Settings
    </h1>

    <section class="section">
      <div class="section-header">
        <h2 class="section-title">
          Discord bot (optional)
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
            No token — optional
          </span>
        </p>
      </div>
      <p class="section-desc">
        A bot token is only needed to play into Discord voice channels. Playing at the table through this computer's speakers works without one.
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
            data-testid="discord-token-save"
            :disabled="saving || !tokenInput.trim()"
            @click="saveToken"
          >
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
          <button
            v-if="discordConfig?.tokenConfigured && !discordConfig.fromEnvironment"
            type="button"
            class="btn btn-ghost"
            data-testid="discord-token-remove"
            :disabled="removing || saving"
            @click="removeToken"
          >
            {{ removing ? 'Removing…' : 'Remove' }}
          </button>
        </div>
        <p v-if="discordConfig?.fromEnvironment" class="field-hint">
          The token comes from the DISCORD_TOKEN environment variable; unset it to remove the token.
        </p>
        <p v-if="discordConfig && !discordConfig.encrypted" class="field-hint field-hint-warning">
          Not encrypted on this system — stored as plain text.
        </p>
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

    <section class="section" data-testid="local-playback-section">
      <div class="section-header">
        <h2 class="section-title">
          Local playback
        </h2>
      </div>
      <p class="section-desc">
        Pick which speakers the Local Target plays through, for example a table speaker while your headset carries Discord. Changes apply immediately. The Browser tab always plays through the system default.
      </p>
      <div class="field">
        <label for="output-device" class="field-label">Output device</label>
        <select
          id="output-device"
          class="input field-input"
          :value="outputDeviceChoice?.deviceId ?? ''"
          @change="changeOutputDevice"
        >
          <option value="">
            System default
          </option>
          <option v-for="device in outputDevices" :key="device.deviceId" :value="device.deviceId">
            {{ device.label }}
          </option>
          <option v-if="absentOutputDevice" :value="absentOutputDevice.deviceId">
            {{ absentOutputDevice.label || absentOutputDevice.deviceId }} (not connected)
          </option>
        </select>
      </div>
      <p
        v-if="outputDeviceMessage"
        class="status-message settings-message"
        :class="[outputDeviceMessage.type === 'success' ? 'status-message-success' : 'status-message-error']"
      >
        {{ outputDeviceMessage.text }}
      </p>
    </section>

    <hr class="divider">

    <section class="section" data-testid="hotkeys-section">
      <div class="section-header">
        <h2 class="section-title">
          Hotkeys
        </h2>
      </div>
      <p class="section-desc">
        Global hotkeys work while Hibiki is in the background, for example from a Stream Deck. Scene Hotkeys are always live; Effect Hotkeys are live for the Playing Scene only, so Scenes can reuse the same keys. Bind them in the Scene editor. The rows below bind fixed actions: stopping the Scene or its Effects, moving to the previous or next Scene, and stepping the master volume by 5.
      </p>
      <div class="toggle-list">
        <div class="toggle-row">
          <input
            id="hotkeys-enabled"
            type="checkbox"
            class="toggle-input"
            :checked="hotkeySettings.enabled"
            :disabled="savingHotkeys"
            @change="toggleHotkeys"
          >
          <div class="toggle-text">
            <label for="hotkeys-enabled" class="toggle-title">Enable global hotkeys</label>
            <span class="toggle-desc">Turn off to hand every key back to the OS without losing your bindings.</span>
          </div>
        </div>
      </div>
      <div v-for="row in actionHotkeyRows" :key="row.field" class="field">
        <span class="field-label">{{ row.label }}</span>
        <HotkeyRecorder
          :model-value="hotkeySettings[row.field]"
          :label="`${row.label} Hotkey`"
          :error="actionHotkeyErrors[row.field] ?? null"
          @update:model-value="setActionHotkey(row.field, $event)"
        />
      </div>
      <p
        v-if="hotkeyMessage"
        class="status-message settings-message"
        :class="[hotkeyMessage.type === 'success' ? 'status-message-success' : 'status-message-error']"
      >
        {{ hotkeyMessage.text }}
      </p>
    </section>

    <hr class="divider">

    <section class="section" data-testid="updates-section">
      <div class="section-header">
        <h2 class="section-title">
          Updates
        </h2>
      </div>
      <p class="section-desc">
        Hibiki never downloads or installs anything. It only tells you when a new version is out, so you can update the way you installed it.
      </p>
      <div class="toggle-list">
        <div class="toggle-row">
          <input
            id="update-check-enabled"
            type="checkbox"
            class="toggle-input"
            :checked="updateCheckEnabled"
            :disabled="savingUpdateCheck"
            @change="toggleUpdateCheck"
          >
          <div class="toggle-text">
            <label for="update-check-enabled" class="toggle-title">Check for updates on launch</label>
            <span class="toggle-desc">Asks GitHub once per launch whether a newer release exists. Turn off to make no request at all.</span>
          </div>
        </div>
      </div>
      <p
        v-if="updateCheckMessage"
        class="status-message settings-message"
        :class="[updateCheckMessage.type === 'success' ? 'status-message-success' : 'status-message-error']"
      >
        {{ updateCheckMessage.text }}
      </p>
    </section>

    <hr class="divider">

    <section class="section" data-testid="usage-stats-section">
      <div class="section-header">
        <h2 class="section-title">
          Usage Stats
        </h2>
      </div>
      <p class="section-desc">
        Anonymous counts of which features get used, sent to the project's own Umami server so development follows what GMs actually do. Off unless you switch it on. No identifier is stored on this computer, so switching off leaves nothing behind.
      </p>
      <div class="toggle-list">
        <div class="toggle-row">
          <input
            id="usage-stats-enabled"
            type="checkbox"
            class="toggle-input"
            :checked="usageStatsEnabled"
            :disabled="savingUsageStats"
            @change="toggleUsageStats"
          >
          <div class="toggle-text">
            <label for="usage-stats-enabled" class="toggle-title">Share anonymous Usage Stats</label>
            <span class="toggle-desc">Never includes server, channel, Scene, sound or Hotkey names, website addresses, or anything else you created.</span>
          </div>
        </div>
      </div>
      <div class="usage-stats-list" data-testid="usage-stats-list">
        <span class="field-label">What is sent</span>
        <ul>
          <li v-for="event in USAGE_STATS_EVENTS" :key="event.name">
            <strong>{{ event.name }}</strong>: {{ event.sent }}
          </li>
        </ul>
        <p class="section-desc">
          Every event also carries the name of the screen you are on and identifies the app as Hibiki with its version and operating system. The full list is on the
          <a
            :href="PRIVACY_PAGE_URL"
            target="_blank"
            rel="noopener"
            class="settings-link"
            data-testid="usage-stats-privacy-link"
          >privacy page</a>.
        </p>
      </div>
      <p
        v-if="usageStatsMessage"
        class="status-message settings-message"
        :class="[usageStatsMessage.type === 'success' ? 'status-message-success' : 'status-message-error']"
      >
        {{ usageStatsMessage.text }}
      </p>
    </section>

    <hr class="divider">

    <section class="section">
      <div class="section-header">
        <h2 class="section-title">
          Diagnostics
        </h2>
      </div>
      <p class="section-desc">
        Hibiki writes what happens behind the scenes (Discord voice connection, audio playback, errors) to a log file. If the bot joins but you hear nothing, this file is what to send along with a bug report.
      </p>
      <div class="field">
        <label for="log-path" class="field-label">Log file</label>
        <div class="field-row">
          <input
            id="log-path"
            :value="logPath ?? '(unavailable)'"
            type="text"
            readonly
            class="input field-input input-readonly"
          >
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!logPath"
            @click="openLogFolder"
          >
            Open log folder
          </button>
        </div>
      </div>
      <div class="field" data-testid="hotkey-failures">
        <span class="field-label">Hotkeys the OS refused</span>
        <ul v-if="hotkeyFailures.length > 0" class="hotkey-failure-list">
          <li v-for="f in hotkeyFailures" :key="`${f.accelerator}-${f.owner}`">
            <kbd class="hotkey-failure-key">{{ f.accelerator }}</kbd> ({{ f.owner }}): {{ f.reason }}
          </li>
        </ul>
        <p v-else class="section-desc">
          None. Every bound hotkey is registered.
        </p>
      </div>
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

    <hr class="divider">

    <section class="section">
      <div class="section-header">
        <h2 class="section-title">
          Scene transitions
        </h2>
      </div>
      <p class="section-desc">
        How long Scenes take to crossfade when you switch between them.
      </p>
      <div class="field">
        <label for="scene-fade-length" class="field-label">Fade length</label>
        <div class="field-row">
          <input
            id="scene-fade-length"
            type="range"
            :min="SCENE_FADE_LENGTH_MIN_SECONDS"
            :max="SCENE_FADE_LENGTH_MAX_SECONDS"
            :step="SCENE_FADE_LENGTH_STEP_SECONDS"
            class="fade-slider"
            :value="sceneFadeLength"
            :disabled="savingFadeLength"
            @change="onSceneFadeLengthChange"
          >
          <span class="fade-value">{{ sceneFadeLength === 0 ? 'Hard cut' : `${sceneFadeLength}s` }}</span>
        </div>
        <p class="field-hint">
          0 seconds switches Scenes with a hard cut instead of a fade.
        </p>
      </div>
      <p
        v-if="fadeLengthMessage"
        class="status-message settings-message"
        :class="[fadeLengthMessage.type === 'success' ? 'status-message-success' : 'status-message-error']"
      >
        {{ fadeLengthMessage.text }}
      </p>
    </section>

    <hr class="divider">

    <section class="section">
      <div class="section-header">
        <h2 class="section-title">
          Vision to Vibe
        </h2>
        <p v-if="visionConfig" class="section-status">
          <span v-if="visionConfig.enabled && visionConfig.configured" class="status-connected">On</span>
          <span v-else-if="visionConfig.configured" class="status-missing">Configured, switched off</span>
          <span v-else class="status-missing">Not configured</span>
        </p>
      </div>
      <p class="section-desc">
        Drop a battle map or mood-board image into a scene and get matching Music and Ambience suggestions from your own tagged sound library.
        <strong class="privacy-note">
          <template v-if="isOpenAiCompatible">Opt-in: each image you analyze is sent to the endpoint configured below.</template>
          <template v-else>Opt-in: each image you analyze is sent to Anthropic's Claude API using your key.</template>
        </strong>
        Hibiki does not keep the image after the request. Off by default.
      </p>
      <div class="field">
        <label for="vision-provider" class="field-label">Vision Provider</label>
        <select
          id="vision-provider"
          class="input field-input"
          :value="visionConfig?.provider"
          :disabled="savingVisionProvider"
          @change="changeVisionProvider"
        >
          <option value="claude">
            Claude (Anthropic)
          </option>
          <option value="openai-compatible">
            OpenAI-compatible endpoint
          </option>
        </select>
      </div>
      <div class="field">
        <label for="vision-api-key" class="field-label">{{ providerLabel }} API key</label>
        <div class="field-row">
          <input
            id="vision-api-key"
            v-model="visionKeyInput"
            type="password"
            :placeholder="selectedProviderStatus?.keyConfigured
              ? 'Key saved — paste a new key to replace it'
              : (isOpenAiCompatible ? 'Paste an API key (optional for keyless local servers)' : 'Paste your Anthropic API key')"
            autocomplete="off"
            class="input field-input"
          >
          <button
            type="button"
            class="btn btn-primary"
            data-testid="vision-save-key"
            :disabled="savingVisionKey || !visionKeyInput.trim()"
            @click="saveVisionKey"
          >
            {{ savingVisionKey ? 'Saving…' : 'Save' }}
          </button>
          <button
            v-if="selectedProviderStatus?.keyConfigured"
            type="button"
            class="btn btn-ghost"
            :disabled="savingVisionKey"
            @click="clearVisionKey"
          >
            Remove
          </button>
        </div>
        <p v-if="selectedProviderStatus && !selectedProviderStatus.encrypted" class="field-hint field-hint-warning" data-testid="vision-key-plaintext-warning">
          Not encrypted on this system — stored as plain text.
        </p>
      </div>
      <template v-if="isOpenAiCompatible">
        <div class="field">
          <label for="vision-base-url" class="field-label">Base URL</label>
          <div class="field-row">
            <input
              id="vision-base-url"
              v-model="visionBaseUrlInput"
              type="text"
              autocomplete="off"
              class="input field-input"
            >
            <button
              type="button"
              class="btn btn-primary"
              data-testid="vision-save-base-url"
              :disabled="savingVisionAdvanced"
              @click="saveVisionBaseUrl"
            >
              Save
            </button>
            <button
              type="button"
              class="btn btn-ghost"
              data-testid="vision-reset-base-url"
              :disabled="savingVisionAdvanced"
              @click="resetVisionBaseUrl"
            >
              Reset
            </button>
          </div>
        </div>
        <div class="field">
          <label for="vision-model" class="field-label">Model</label>
          <div class="field-row">
            <input
              id="vision-model"
              v-model="visionModelInput"
              type="text"
              autocomplete="off"
              class="input field-input"
            >
            <button
              type="button"
              class="btn btn-primary"
              data-testid="vision-save-model"
              :disabled="savingVisionAdvanced"
              @click="saveVisionModel"
            >
              Save
            </button>
            <button
              type="button"
              class="btn btn-ghost"
              data-testid="vision-reset-model"
              :disabled="savingVisionAdvanced"
              @click="resetVisionModel"
            >
              Reset
            </button>
          </div>
        </div>
      </template>
      <div class="toggle-list vision-toggle-list">
        <div class="toggle-row" :class="{ 'toggle-row-disabled': !visionConfig?.configured }">
          <input
            id="vision-enabled"
            type="checkbox"
            class="toggle-input"
            :checked="Boolean(visionConfig?.enabled)"
            :disabled="!visionConfig?.configured || savingVisionToggle"
            @change="toggleVision"
          >
          <div class="toggle-text">
            <label for="vision-enabled" class="toggle-title">Enable Vision to Vibe</label>
            <span class="toggle-desc">
              {{ visionConfig?.configured
                ? 'Shows the Vision to Vibe button in the scene editor.'
                : (isOpenAiCompatible ? 'Add a key, or a custom Base URL for a keyless local server, first.' : 'Save an API key first.') }}
            </span>
          </div>
        </div>
      </div>
      <p
        v-if="visionMessage"
        class="status-message settings-message"
        :class="[visionMessage.type === 'success' ? 'status-message-success' : 'status-message-error']"
      >
        {{ visionMessage.text }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.hotkey-failure-list {
  margin: 0;
  padding-left: 1.25rem;
  font-size: 0.85rem;
}

.hotkey-failure-key {
  font-family: inherit;
  font-weight: 600;
}

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

.field-hint {
  margin: 0.4rem 0 0;
  font-size: 0.78rem;
  color: var(--color-text-dim);
}

.field-hint-warning {
  color: var(--color-warning);
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

/* ── Scene transitions ── */

.fade-slider {
  flex: 1;
  accent-color: var(--color-accent);
}

.fade-value {
  min-width: 4.5rem;
  text-align: right;
  font-size: 0.85rem;
  color: var(--color-text-muted);
  flex-shrink: 0;
}

/* ── Vision to Vibe ── */

.usage-stats-list {
  margin-top: 1rem;
}

.usage-stats-list ul {
  margin: 0.4rem 0 0.75rem;
  padding-left: 1.1rem;
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

.usage-stats-list li + li {
  margin-top: 0.2rem;
}

.usage-stats-list strong {
  color: var(--color-text);
  font-weight: 600;
}

.privacy-note {
  display: block;
  margin-top: 0.5rem;
  color: var(--color-text);
  font-weight: 600;
}

.vision-toggle-list {
  margin-top: 1rem;
}

.toggle-row-disabled {
  opacity: 0.6;
}

.toggle-row-disabled .toggle-title {
  cursor: not-allowed;
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
