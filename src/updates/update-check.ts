import { createLogger } from '../logger'

const log = createLogger('updates')

const SETTINGS_KEY = 'updates'

export const LATEST_RELEASE_URL = 'https://api.github.com/repos/PhyberApex/hibiki/releases/latest'
const RELEASE_PAGE_PREFIX = 'https://github.com/PhyberApex/hibiki/releases/'
export const DEFAULT_UPDATE_CHECK_TIMEOUT_MS = 5000

export interface UpdateCheckSettings {
  enabled: boolean
}

export interface AvailableUpdate {
  version: string
  url: string
}

/** The slice of `fetch` the check needs, so tests can stand in for GitHub. */
export type FetchLike = (url: string, init: { headers: Record<string, string>, signal: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

export interface UpdateCheckStore {
  get: (key: string) => Promise<string | null | undefined>
  set: (key: string, value: string) => Promise<void>
}

interface StoredSettings extends UpdateCheckSettings {
  dismissedVersion?: string
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/

function parseVersion(version: string): { core: number[], prerelease: string | null } | null {
  const match = VERSION_PATTERN.exec(version.trim())
  if (!match)
    return null
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] ?? null }
}

/** Whether `candidate` is a later release than `current`; a prerelease sorts before its release. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b)
    return false
  for (let i = 0; i < 3; i++) {
    if (a.core[i] !== b.core[i])
      return a.core[i] > b.core[i]
  }
  if (a.prerelease === b.prerelease)
    return false
  if (a.prerelease === null)
    return true
  if (b.prerelease === null)
    return false
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true }) > 0
}

function parseSettings(raw: string | null | undefined): StoredSettings {
  if (!raw)
    return { enabled: true }
  try {
    const data = JSON.parse(raw) as Partial<StoredSettings> | null
    return {
      enabled: typeof data?.enabled === 'boolean' ? data.enabled : true,
      ...(typeof data?.dismissedVersion === 'string' ? { dismissedVersion: data.dismissedVersion } : {}),
    }
  }
  catch (e) {
    log.warn('Stored update check settings are unreadable; using defaults:', e)
    return { enabled: true }
  }
}

function parseRelease(body: unknown): AvailableUpdate | null {
  if (typeof body !== 'object' || body === null)
    return null
  const { tag_name: tag, html_url: url } = body as { tag_name?: unknown, html_url?: unknown }
  if (typeof tag !== 'string' || typeof url !== 'string' || !url.startsWith(RELEASE_PAGE_PREFIX) || !parseVersion(tag))
    return null
  return { version: tag.trim().replace(/^v/, ''), url }
}

/**
 * The launch update notice (issue #541): one GET to the GitHub Releases API,
 * bounded by a short timeout, that only ever reports — no download, no
 * install, so Homebrew and AUR installs stay in charge of updating. A GM can
 * turn it off in Settings and dismiss a version so it is not shown again.
 */
export function createUpdateCheck({ store, currentVersion, fetch, timeoutMs = DEFAULT_UPDATE_CHECK_TIMEOUT_MS }: {
  store: UpdateCheckStore
  currentVersion: string
  fetch: FetchLike
  timeoutMs?: number
}) {
  async function read(): Promise<StoredSettings> {
    return parseSettings(await store.get(SETTINGS_KEY))
  }

  async function write(settings: StoredSettings): Promise<void> {
    await store.set(SETTINGS_KEY, JSON.stringify(settings))
  }

  async function fetchLatest(): Promise<AvailableUpdate | null> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(LATEST_RELEASE_URL, {
        headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': `Hibiki/${currentVersion}` },
        signal: controller.signal,
      })
      if (!response.ok) {
        log.warn(`Update check failed: GitHub answered HTTP ${response.status}`)
        return null
      }
      const latest = parseRelease(await response.json())
      if (!latest)
        log.warn('Update check failed: GitHub returned no usable release')
      return latest
    }
    catch (e) {
      if (controller.signal.aborted)
        log.warn(`Update check timed out after ${timeoutMs} ms`)
      else
        log.warn('Update check failed:', e)
      return null
    }
    finally {
      clearTimeout(timer)
    }
  }

  return {
    async getSettings(): Promise<UpdateCheckSettings> {
      const { enabled } = await read()
      return { enabled }
    },

    async setEnabled(enabled: boolean): Promise<void> {
      log.info(`Update check on launch turned ${enabled ? 'on' : 'off'}`)
      await write({ ...await read(), enabled: Boolean(enabled) })
    },

    /** Remembers `version` so its notice is not shown on later launches; a newer release still is. */
    async dismiss(version: string): Promise<void> {
      log.info(`Update notice for ${version} dismissed`)
      await write({ ...await read(), dismissedVersion: version })
    },

    /** The newer release to tell the GM about, or `null` (turned off, up to date, dismissed, offline). */
    async check(): Promise<AvailableUpdate | null> {
      const settings = await read()
      if (!settings.enabled) {
        log.info('Update check skipped: turned off in Settings')
        return null
      }
      log.info(`Checking GitHub for a release newer than ${currentVersion}`)
      const latest = await fetchLatest()
      if (!latest)
        return null
      if (!isNewerVersion(latest.version, currentVersion)) {
        log.info(`Up to date (latest release is ${latest.version})`)
        return null
      }
      if (settings.dismissedVersion === latest.version) {
        log.info(`Release ${latest.version} is available, but its notice was dismissed`)
        return null
      }
      log.info(`Release ${latest.version} is available: ${latest.url}`)
      return latest
    },
  }
}
