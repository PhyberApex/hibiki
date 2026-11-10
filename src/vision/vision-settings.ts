import type { Config } from '../config'
import type { createAppConfig } from '../persistence'
import type { VisionProviderConfig, VisionProviderId } from './vision.service'
import { createLogger } from '../logger'
import { describeEndpoint, endpointOrigin, validateOpenAiBaseUrl } from './vision-endpoint'
import { OPENAI_COMPATIBLE_DEFAULT_BASE_URL, OPENAI_COMPATIBLE_DEFAULT_MODEL } from './vision.service'

export interface VisionProviderState {
  keyConfigured: boolean
  configured: boolean
  /** Whether a stored key is encrypted at rest (see `createAppConfig`'s `SecretCodec`); false means plain text on disk. */
  encrypted: boolean
}

export interface VisionOpenAICompatibleState extends VisionProviderState {
  baseUrl: string
  model: string
  /**
   * A key exists but is withheld from the current Base URL because it was entered for a different endpoint
   * (or, for the env key, because the Base URL is not OpenAI's). `keyConfigured` is false in that case (#767).
   */
  keyWithheld: boolean
}

export interface VisionSettingsState {
  provider: VisionProviderId
  enabled: boolean
  /** Gate for the currently selected provider — mirrors `claude.configured` or `openaiCompatible.configured`. */
  configured: boolean
  claude: VisionProviderState
  openaiCompatible: VisionOpenAICompatibleState
}

const PROVIDER_CONFIG_KEY = 'vision.provider'
const CLAUDE_API_KEY_CONFIG_KEY = 'vision.apiKey'
const OPENAI_API_KEY_CONFIG_KEY = 'vision.openai.apiKey'
/** Origin of the Base URL the stored OpenAI-compatible key was entered for; the key is only ever sent there. */
const OPENAI_API_KEY_ORIGIN_CONFIG_KEY = 'vision.openai.apiKeyOrigin'
const OPENAI_BASE_URL_CONFIG_KEY = 'vision.openai.baseUrl'
const OPENAI_MODEL_CONFIG_KEY = 'vision.openai.model'
const ENABLED_CONFIG_KEY = 'vision.enabled'

function isVisionProviderId(value: string | null): value is VisionProviderId {
  return value === 'claude' || value === 'openai-compatible'
}

const log = createLogger('vision-settings')

export function createVisionSettings(config: Config, appConfig: ReturnType<typeof createAppConfig>) {
  async function getProvider(): Promise<VisionProviderId> {
    const stored = await appConfig.get(PROVIDER_CONFIG_KEY)
    return isVisionProviderId(stored)
      ? stored
      : 'claude'
  }

  async function getClaudeApiKey(): Promise<string | null> {
    if (config.vision.apiKey)
      return config.vision.apiKey
    const stored = await appConfig.get(CLAUDE_API_KEY_CONFIG_KEY)
    return stored?.trim()
      ? stored
      : null
  }

  /** The stored OpenAI-compatible key and the origin it was saved for (null for a key saved before binding existed). */
  async function getStoredOpenAiKey(): Promise<{ key: string | null, boundOrigin: string | null }> {
    const [key, boundOrigin] = await Promise.all([
      appConfig.get(OPENAI_API_KEY_CONFIG_KEY),
      appConfig.get(OPENAI_API_KEY_ORIGIN_CONFIG_KEY),
    ])
    return {
      key: key?.trim()
        ? key
        : null,
      boundOrigin: boundOrigin?.trim() || null,
    }
  }

  /**
   * The OpenAI-compatible key to send to `baseUrl`, bound to an origin so that changing the Base URL to
   * another host never hands that host the key (#767). The env key belongs to OpenAI's own origin and wins
   * there; elsewhere the stored key is used if it was saved for this origin (a key saved before binding
   * existed belongs to the current Base URL until the Base URL changes, see `setOpenAiBaseUrl`).
   */
  async function getOpenAiKey(baseUrl: string): Promise<{ apiKey: string | null, withheld: boolean }> {
    const origin = endpointOrigin(baseUrl)
    const envKey = config.vision.openaiApiKey
    if (envKey && origin === endpointOrigin(OPENAI_COMPATIBLE_DEFAULT_BASE_URL))
      return { apiKey: envKey, withheld: false }
    const { key, boundOrigin } = await getStoredOpenAiKey()
    if (key && origin !== null && (boundOrigin ?? origin) === origin)
      return { apiKey: key, withheld: false }
    return {
      apiKey: null,
      withheld: Boolean(envKey || key),
    }
  }

  async function getStoredOrDefault(key: string, defaultValue: string): Promise<string> {
    const stored = await appConfig.get(key)
    return stored?.trim()
      ? stored.trim()
      : defaultValue
  }

  function setStored(key: string, value: string): Promise<void> {
    return appConfig.set(key, typeof value === 'string'
      ? value.trim()
      : '')
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
      const [baseUrl, model] = await Promise.all([
        getOpenAiBaseUrl(),
        getOpenAiModel(),
      ])
      const { apiKey, withheld } = await getOpenAiKey(baseUrl)
      if (withheld)
        log.warn(`openai-compatible API key withheld from ${describeEndpoint(baseUrl)}: it was saved for another endpoint (or is the env key, which only goes to OpenAI)`)
      return { provider, apiKey, baseUrl, model }
    }
    return { provider: 'claude', apiKey: await getClaudeApiKey() }
  }

  async function get(): Promise<VisionSettingsState> {
    const [provider, enabledValue, claudeKey, baseUrl, model] = await Promise.all([
      getProvider(),
      appConfig.get(ENABLED_CONFIG_KEY),
      getClaudeApiKey(),
      getOpenAiBaseUrl(),
      getOpenAiModel(),
    ])
    const { apiKey: openaiKey, withheld: openaiKeyWithheld } = await getOpenAiKey(baseUrl)

    const claude: VisionProviderState = {
      keyConfigured: Boolean(claudeKey),
      configured: Boolean(claudeKey),
      encrypted: appConfig.secretsEncrypted,
    }
    const openaiCompatible: VisionOpenAICompatibleState = {
      keyConfigured: Boolean(openaiKey),
      configured: Boolean(openaiKey) || baseUrl !== OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
      encrypted: appConfig.secretsEncrypted,
      baseUrl,
      model,
      keyWithheld: openaiKeyWithheld,
    }

    return {
      provider,
      enabled: enabledValue === 'true',
      configured: provider === 'openai-compatible'
        ? openaiCompatible.configured
        : claude.configured,
      claude,
      openaiCompatible,
    }
  }

  return {
    getProviderConfig,
    get,
    async setProvider(provider: VisionProviderId): Promise<VisionSettingsState> {
      log.info(`Vision Provider set to ${provider}`)
      await appConfig.set(PROVIDER_CONFIG_KEY, provider)
      return get()
    },
    async setApiKey(provider: VisionProviderId, apiKey: string): Promise<VisionSettingsState> {
      const key = provider === 'openai-compatible'
        ? OPENAI_API_KEY_CONFIG_KEY
        : CLAUDE_API_KEY_CONFIG_KEY
      log.info(`${provider} API key ${apiKey.trim()
        ? 'updated'
        : 'cleared'}`)
      await setStored(key, apiKey)
      if (provider === 'openai-compatible') {
        // Bind the key to the endpoint it was entered for; it is never sent anywhere else.
        const origin = apiKey.trim()
          ? endpointOrigin(await getOpenAiBaseUrl()) ?? ''
          : ''
        await appConfig.set(OPENAI_API_KEY_ORIGIN_CONFIG_KEY, origin)
        if (origin)
          log.info(`openai-compatible API key bound to ${origin}`)
      }
      return get()
    },
    async setOpenAiBaseUrl(baseUrl: string): Promise<VisionSettingsState> {
      const next = typeof baseUrl === 'string'
        ? baseUrl.trim()
        : ''
      if (next) {
        try {
          validateOpenAiBaseUrl(next)
        }
        catch (err) {
          log.warn(`Rejected OpenAI-compatible Base URL (${describeEndpoint(next)}): ${(err as Error).message}`)
          throw err
        }
      }
      const previous = await getOpenAiBaseUrl()
      // A key saved before keys were bound to an endpoint belongs to the Base URL it was used with until now.
      const { key: storedKey, boundOrigin } = await getStoredOpenAiKey()
      if (storedKey && !boundOrigin) {
        const previousOrigin = endpointOrigin(previous)
        if (previousOrigin)
          await appConfig.set(OPENAI_API_KEY_ORIGIN_CONFIG_KEY, previousOrigin)
      }
      await setStored(OPENAI_BASE_URL_CONFIG_KEY, next)
      const state = await get()
      log.info(`OpenAI-compatible Base URL set to ${describeEndpoint(state.openaiCompatible.baseUrl)}${next ? '' : ' (default)'}${state.openaiCompatible.keyWithheld
        ? '; the saved API key belongs to another endpoint and is withheld'
        : ''}`)
      return state
    },
    async setOpenAiModel(model: string): Promise<VisionSettingsState> {
      await setStored(OPENAI_MODEL_CONFIG_KEY, model)
      return get()
    },
    async setEnabled(enabled: boolean): Promise<VisionSettingsState> {
      log.info(`Vision to Vibe ${enabled ? 'enabled' : 'disabled'}`)
      await appConfig.set(ENABLED_CONFIG_KEY, enabled ? 'true' : 'false')
      return get()
    },
  }
}

export type VisionSettings = ReturnType<typeof createVisionSettings>
