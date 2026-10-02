import type { Config } from '../config'
import type { createAppConfig } from '../persistence'
import type { VisionProviderConfig, VisionProviderId } from './vision.service'
import { OPENAI_COMPATIBLE_DEFAULT_BASE_URL, OPENAI_COMPATIBLE_DEFAULT_MODEL } from './vision.service'

export interface VisionProviderState {
  keyConfigured: boolean
  configured: boolean
}

/** The Claude key is the only Vision secret encrypted at rest (see `createAppConfig`'s `SecretCodec`). */
export interface VisionClaudeState extends VisionProviderState {
  encrypted: boolean
}

export interface VisionOpenAICompatibleState extends VisionProviderState {
  baseUrl: string
  model: string
}

export interface VisionSettingsState {
  provider: VisionProviderId
  enabled: boolean
  /** Gate for the currently selected provider — mirrors `claude.configured` or `openaiCompatible.configured`. */
  configured: boolean
  claude: VisionClaudeState
  openaiCompatible: VisionOpenAICompatibleState
}

const PROVIDER_CONFIG_KEY = 'vision.provider'
const CLAUDE_API_KEY_CONFIG_KEY = 'vision.apiKey'
const OPENAI_API_KEY_CONFIG_KEY = 'vision.openai.apiKey'
const OPENAI_BASE_URL_CONFIG_KEY = 'vision.openai.baseUrl'
const OPENAI_MODEL_CONFIG_KEY = 'vision.openai.model'
const ENABLED_CONFIG_KEY = 'vision.enabled'

function isVisionProviderId(value: string | null): value is VisionProviderId {
  return value === 'claude' || value === 'openai-compatible'
}

export function createVisionSettings(config: Config, appConfig: ReturnType<typeof createAppConfig>) {
  async function getProvider(): Promise<VisionProviderId> {
    const stored = await appConfig.get(PROVIDER_CONFIG_KEY)
    return isVisionProviderId(stored) ? stored : 'claude'
  }

  async function getClaudeApiKey(): Promise<string | null> {
    if (config.vision.apiKey)
      return config.vision.apiKey
    const stored = await appConfig.get(CLAUDE_API_KEY_CONFIG_KEY)
    return stored?.trim() ? stored : null
  }

  async function getOpenAiApiKey(): Promise<string | null> {
    if (config.vision.openaiApiKey)
      return config.vision.openaiApiKey
    const stored = await appConfig.get(OPENAI_API_KEY_CONFIG_KEY)
    return stored?.trim() ? stored : null
  }

  async function getStoredOrDefault(key: string, defaultValue: string): Promise<string> {
    const stored = await appConfig.get(key)
    return stored?.trim() ? stored.trim() : defaultValue
  }

  function setStored(key: string, value: string): Promise<void> {
    return appConfig.set(key, typeof value === 'string' ? value.trim() : '')
  }

  function getOpenAiBaseUrl(): Promise<string> {
    return getStoredOrDefault(OPENAI_BASE_URL_CONFIG_KEY, OPENAI_COMPATIBLE_DEFAULT_BASE_URL)
  }

  function getOpenAiModel(): Promise<string> {
    return getStoredOrDefault(OPENAI_MODEL_CONFIG_KEY, OPENAI_COMPATIBLE_DEFAULT_MODEL)
  }

  async function getProviderConfig(): Promise<VisionProviderConfig> {
    const provider = await getProvider()
    if (provider === 'openai-compatible') {
      const [apiKey, baseUrl, model] = await Promise.all([getOpenAiApiKey(), getOpenAiBaseUrl(), getOpenAiModel()])
      return { provider, apiKey, baseUrl, model }
    }
    return { provider: 'claude', apiKey: await getClaudeApiKey() }
  }

  async function get(): Promise<VisionSettingsState> {
    const [provider, enabledValue, claudeKey, openaiKey, baseUrl, model] = await Promise.all([
      getProvider(),
      appConfig.get(ENABLED_CONFIG_KEY),
      getClaudeApiKey(),
      getOpenAiApiKey(),
      getOpenAiBaseUrl(),
      getOpenAiModel(),
    ])

    const claude: VisionClaudeState = {
      keyConfigured: Boolean(claudeKey),
      configured: Boolean(claudeKey),
      encrypted: appConfig.secretsEncrypted,
    }
    const openaiCompatible: VisionOpenAICompatibleState = {
      keyConfigured: Boolean(openaiKey),
      configured: Boolean(openaiKey) || baseUrl !== OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
      baseUrl,
      model,
    }

    return {
      provider,
      enabled: enabledValue === 'true',
      configured: provider === 'openai-compatible' ? openaiCompatible.configured : claude.configured,
      claude,
      openaiCompatible,
    }
  }

  return {
    getProviderConfig,
    get,
    async setProvider(provider: VisionProviderId): Promise<VisionSettingsState> {
      await appConfig.set(PROVIDER_CONFIG_KEY, provider)
      return get()
    },
    async setApiKey(provider: VisionProviderId, apiKey: string): Promise<VisionSettingsState> {
      const key = provider === 'openai-compatible' ? OPENAI_API_KEY_CONFIG_KEY : CLAUDE_API_KEY_CONFIG_KEY
      await setStored(key, apiKey)
      return get()
    },
    async setOpenAiBaseUrl(baseUrl: string): Promise<VisionSettingsState> {
      await setStored(OPENAI_BASE_URL_CONFIG_KEY, baseUrl)
      return get()
    },
    async setOpenAiModel(model: string): Promise<VisionSettingsState> {
      await setStored(OPENAI_MODEL_CONFIG_KEY, model)
      return get()
    },
    async setEnabled(enabled: boolean): Promise<VisionSettingsState> {
      await appConfig.set(ENABLED_CONFIG_KEY, enabled ? 'true' : 'false')
      return get()
    },
  }
}

export type VisionSettings = ReturnType<typeof createVisionSettings>
