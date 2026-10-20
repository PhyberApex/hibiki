import { apiCall, useElectronApi } from './electron'

export interface UpdateCheckSettings {
  /** "Check for updates on launch": one request to GitHub's Releases API per launch. */
  enabled: boolean
}

export interface AvailableUpdate {
  version: string
  /** The GitHub release page. */
  url: string
}

function requireElectron(): void {
  if (!useElectronApi())
    throw new Error('Electron API not available')
}

export function fetchUpdateCheckSettings(): Promise<UpdateCheckSettings> {
  requireElectron()
  return apiCall<UpdateCheckSettings>('updates', 'getSettings', [])
}

export function updateUpdateCheckEnabled(enabled: boolean): Promise<void> {
  requireElectron()
  return apiCall<void>('updates', 'setEnabled', [enabled])
}

/** A release newer than the running one, unless the check is off, failed, or that version was dismissed. */
export function checkForUpdate(): Promise<AvailableUpdate | null> {
  requireElectron()
  return apiCall<AvailableUpdate | null>('updates', 'check', [])
}

export function dismissUpdate(version: string): Promise<void> {
  requireElectron()
  return apiCall<void>('updates', 'dismiss', [version])
}
