import type { Config } from '../config'
import type { createAppConfig } from '../persistence'

export interface VisionSettingsState {
  apiKeyConfigured: boolean
  enabled: boolean
}

const API_KEY_CONFIG_KEY = 'vision.apiKey'
const ENABLED_CONFIG_KEY = 'vision.enabled'

export function createVisionSettings(config: Config, appConfig: ReturnType<typeof createAppConfig>) {
  async function getApiKey(): Promise<string | null> {
    if (config.vision.apiKey)
      return config.vision.apiKey
    const stored = await appConfig.get(API_KEY_CONFIG_KEY)
    return stored?.trim() ? stored : null
  }

  async function get(): Promise<VisionSettingsState> {
    const [apiKey, enabled] = await Promise.all([getApiKey(), appConfig.get(ENABLED_CONFIG_KEY)])
    return { apiKeyConfigured: Boolean(apiKey), enabled: enabled === 'true' }
  }

  return {
    getApiKey,
    get,
    async setApiKey(apiKey: string): Promise<VisionSettingsState> {
      await appConfig.set(API_KEY_CONFIG_KEY, typeof apiKey === 'string' ? apiKey.trim() : '')
      return get()
    },
    async setEnabled(enabled: boolean): Promise<VisionSettingsState> {
      await appConfig.set(ENABLED_CONFIG_KEY, enabled ? 'true' : 'false')
      return get()
    },
  }
}

export type VisionSettings = ReturnType<typeof createVisionSettings>
