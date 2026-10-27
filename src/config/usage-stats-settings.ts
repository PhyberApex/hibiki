import { createLogger } from '../logger'

const log = createLogger('config')

const USAGE_STATS_KEY = 'usageStats'

/** Usage Stats (ADR-0008): off until the GM switches them on; `prompted` once the Welcome card was answered. */
export interface UsageStatsSettings {
  enabled: boolean
  prompted: boolean
}

export interface UsageStatsSettingsStore {
  get: (key: string) => Promise<string | null | undefined>
  set: (key: string, value: string) => Promise<void>
}

const DEFAULTS: UsageStatsSettings = { enabled: false, prompted: false }

function parse(raw: string | null | undefined): UsageStatsSettings {
  if (!raw)
    return { ...DEFAULTS }
  try {
    const data = JSON.parse(raw) as Partial<UsageStatsSettings> | null
    return {
      enabled: data?.enabled === true,
      prompted: data?.prompted === true,
    }
  }
  catch (e) {
    log.warn('Stored Usage Stats settings are unreadable; using defaults (off):', e)
    return { ...DEFAULTS }
  }
}

export function createUsageStatsSettings(store: UsageStatsSettingsStore) {
  async function get(): Promise<UsageStatsSettings> {
    return parse(await store.get(USAGE_STATS_KEY))
  }

  async function setEnabled(enabled: boolean): Promise<UsageStatsSettings> {
    if (typeof enabled !== 'boolean')
      throw new TypeError('Usage Stats need an "enabled" boolean')
    const next = {
      ...(await get()),
      enabled,
    }
    await store.set(USAGE_STATS_KEY, JSON.stringify(next))
    log.info(`Usage Stats ${enabled ? 'enabled' : 'disabled'}`)
    return next
  }

  async function markPrompted(): Promise<UsageStatsSettings> {
    const next = {
      ...(await get()),
      prompted: true,
    }
    await store.set(USAGE_STATS_KEY, JSON.stringify(next))
    log.info('Usage Stats invitation answered; it will not be shown again')
    return next
  }

  return { get, setEnabled, markPrompted }
}
