import { createLogger } from '../logger'

const log = createLogger('config')

const LOCAL_OUTPUT_DEVICE_KEY = 'output.local.device'

export interface LocalOutputDeviceStore {
  get: (key: string) => Promise<string | null | undefined>
  set: (key: string, value: string) => Promise<void>
}

/** The Output Device the GM picked for the Local Target; "System default" is the absence of one. */
export interface LocalOutputDevice {
  deviceId: string
  label: string
}

/** Anything that is not a well-formed choice means "System default". */
export function normalizeLocalOutputDevice(input: unknown): LocalOutputDevice | null {
  if (!input || typeof input !== 'object')
    return null
  const { deviceId, label } = input as Record<string, unknown>
  if (typeof deviceId !== 'string' || deviceId === '' || deviceId === 'default')
    return null
  return { deviceId, label: typeof label === 'string' ? label : '' }
}

export function createLocalOutputDeviceSettings(store: LocalOutputDeviceStore) {
  async function get(): Promise<LocalOutputDevice | null> {
    const raw = await store.get(LOCAL_OUTPUT_DEVICE_KEY)
    if (!raw)
      return null
    try {
      return normalizeLocalOutputDevice(JSON.parse(raw))
    }
    catch {
      return null
    }
  }

  /** `null` (or anything malformed) clears the key, so System default is stored as absence. */
  async function set(device: unknown): Promise<void> {
    const normalized = normalizeLocalOutputDevice(device)
    // Store has no delete: an empty string is read back as absence.
    await store.set(LOCAL_OUTPUT_DEVICE_KEY, normalized ? JSON.stringify(normalized) : '')
    log.info(normalized
      ? `Local output device set to "${normalized.label}" (${normalized.deviceId})`
      : 'Local output device cleared (system default)')
  }

  return { get, set }
}
