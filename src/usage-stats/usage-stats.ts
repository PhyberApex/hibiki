import type { UsageStatsSettings } from '../config/usage-stats-settings'
import { Umami } from '@umami/node'
import { createLogger } from '../logger'
import { isAllowedValue, USAGE_STATS_EVENTS, USAGE_STATS_HOSTNAME, USAGE_STATS_URLS } from './allowlist'

const log = createLogger('usage-stats')

/** The project's self-hosted Umami (ADR-0008); public by nature, like the docs site's. */
export const USAGE_STATS_HOST = 'https://analytics.phyberapex.de'
export const USAGE_STATS_WEBSITE_ID = '4c89f308-354c-46a9-be07-375caeb0e1c1'
export const DEFAULT_USAGE_STATS_TIMEOUT_MS = 5000

/** What the renderer (or main) asks to send; checked against the allowlist before anything leaves. */
export interface UsageStatsEvent {
  name: string
  /** The router's path pattern of the current view, e.g. `/scenes/:id`. */
  url?: string
  data?: Record<string, unknown>
}

export type UsageStatsData = Record<string, string | number | boolean>

/** An event that passed the allowlist, exactly as it is sent. */
export interface UsageStatsPayload {
  name: string
  url: string
  hostname: string
  data: UsageStatsData
}

/** The Umami client behind one method, so tests can stand in for the network. */
export interface UsageStatsSender {
  send: (payload: UsageStatsPayload) => Promise<void>
}

/** Injected by the main process: sends need a packaged build and no `HIBIKI_USAGE_STATS=off`. */
export interface UsageStatsGate {
  packaged: boolean
  killSwitch: boolean
}

export interface UsageStatsEnvironment {
  appVersion: string
  electronVersion: string
  platform: string
  arch: string
  locale: string
}

export interface UsageStatsSettingsSource {
  get: () => Promise<UsageStatsSettings>
  setEnabled: (enabled: boolean) => Promise<UsageStatsSettings>
  markPrompted: () => Promise<UsageStatsSettings>
}

export function resolveUsageStatsHost(override: string | undefined): string {
  return override?.trim() || USAGE_STATS_HOST
}

const UA_OS: Record<string, string> = { darwin: 'Macintosh', win32: 'Windows NT 10.0', linux: 'Linux' }
const UA_ARCH: Record<string, string> = { x64: 'x86_64', ia32: 'x86' }

/** A synthetic User-Agent, so Umami's OS and browser breakdowns read as Hibiki, e.g. `Hibiki/1.7.0 (Electron/41.0.0; Linux x86_64)`. */
export function buildUserAgent(env: Pick<UsageStatsEnvironment, 'appVersion' | 'electronVersion' | 'platform' | 'arch'>): string {
  const os = UA_OS[env.platform] ?? env.platform
  const arch = UA_ARCH[env.arch] ?? env.arch
  return `Hibiki/${env.appVersion} (Electron/${env.electronVersion}; ${os} ${arch})`
}

export function createUmamiSender(options: { host: string, websiteId: string, userAgent: string }): UsageStatsSender {
  const client = new Umami({ hostUrl: options.host, websiteId: options.websiteId, userAgent: options.userAgent })
  return {
    send: async ({ name, url, hostname, data }) => {
      const response = await client.send({
        website: options.websiteId,
        name,
        url,
        hostname,
        // Umami stores booleans too; its client types only list strings, numbers and dates.
        data: data as Record<string, string | number>,
      })
      if (!response.ok)
        throw new Error(`Umami answered ${response.status}`)
    },
  }
}

function quote(name: string): string {
  return JSON.stringify(name.slice(0, 64))
}

/**
 * Checks an event against the allowlist. Returns what may be sent, or the
 * reason it may not; the reason names the event and key, never a value.
 */
function validate(event: UsageStatsEvent): { payload: Omit<UsageStatsPayload, 'hostname'> } | { reason: string } {
  const name = typeof event?.name === 'string' ? event.name : ''
  const rules = Object.hasOwn(USAGE_STATS_EVENTS, name) ? USAGE_STATS_EVENTS[name] : undefined
  if (!rules)
    return { reason: `unknown event ${quote(name)}` }
  const url = event.url ?? '/'
  if (!USAGE_STATS_URLS.includes(url))
    return { reason: `event "${name}" has an unknown url` }
  const data: UsageStatsData = {}
  for (const [key, value] of Object.entries(event.data ?? {})) {
    const rule = Object.hasOwn(rules, key) ? rules[key] : undefined
    if (!rule)
      return { reason: `event "${name}" has a key that is not allowed: ${quote(key)}` }
    if (!isAllowedValue(rule, value))
      return { reason: `event "${name}" has a value outside the allowlist for key "${key}"` }
    data[key] = value as string | number | boolean
  }
  return { payload: { name, url, data } }
}

/**
 * Usage Stats (ADR-0008): the single gate between the app and Umami. Drops
 * everything while disabled or gated, validates every event against the
 * allowlist, and sends fire-and-forget: one attempt, a timeout, no retry,
 * no queue, never awaited by a user action.
 */
export function createUsageStats(options: {
  settings: UsageStatsSettingsSource
  sender: UsageStatsSender
  gate: UsageStatsGate
  environment: UsageStatsEnvironment
  timeoutMs?: number
}) {
  const { settings, sender, gate, environment } = options
  const timeoutMs = options.timeoutMs ?? DEFAULT_USAGE_STATS_TIMEOUT_MS
  const gatedBecause = !gate.packaged ? 'this is not a packaged build' : gate.killSwitch ? 'HIBIKI_USAGE_STATS=off' : null
  let failedBefore = false

  if (gatedBecause)
    log.info(`Usage Stats will never be sent: ${gatedBecause}`)

  function dispatch(payload: UsageStatsPayload): void {
    log.debug(`Sending ${payload.name} (url ${payload.url}):`, JSON.stringify(payload.data))
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs)
      timer.unref?.()
    })
    Promise.race([Promise.resolve().then(() => sender.send(payload)), timeout])
      .catch((err) => {
        if (!failedBefore) {
          failedBefore = true
          log.warn(`Sending ${payload.name} failed; not retried:`, err)
        }
        else {
          log.debug(`Sending ${payload.name} failed; not retried:`, err)
        }
      })
      .finally(() => clearTimeout(timer))
  }

  /** Resolves once the event is dropped or handed to the sender; never waits for the network, never rejects. */
  async function track(event: UsageStatsEvent): Promise<void> {
    try {
      const candidate = event?.name === 'app-start'
        ? { ...event, data: { platform: environment.platform, arch: environment.arch, version: environment.appVersion, locale: environment.locale } }
        : event
      const result = validate(candidate)
      if ('reason' in result) {
        log.warn(`Dropped a Usage Stats event: ${result.reason}`)
        return
      }
      if (gatedBecause || !(await settings.get()).enabled)
        return
      dispatch({ ...result.payload, hostname: USAGE_STATS_HOSTNAME })
    }
    catch (err) {
      log.warn('Usage Stats event not sent:', err)
    }
  }

  async function setEnabled(enabled: boolean): Promise<UsageStatsSettings> {
    const before = await settings.get()
    const next = await settings.setEnabled(enabled)
    if (enabled && !before.enabled)
      await track({ name: 'app-start' })
    return next
  }

  return {
    track,
    getSettings: () => settings.get(),
    setEnabled,
    markPrompted: () => settings.markPrompted(),
  }
}

export type UsageStats = ReturnType<typeof createUsageStats>
