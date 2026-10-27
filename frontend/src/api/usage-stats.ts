import type { Router } from 'vue-router'
import type { OutputTargetKind, VisionProviderId } from './config'
import type { MusicMode } from './scenes'
import { apiCall, useElectronApi } from './electron'

/** Usage Stats (ADR-0008): off until the GM switches them on; `prompted` once the Welcome card was answered. */
export interface UsageStatsSettings {
  enabled: boolean
  prompted: boolean
}

/**
 * The events the renderer emits. The backend allowlist (`src/usage-stats/allowlist.ts`)
 * is what actually decides what leaves the machine; this only keeps call sites honest.
 */
export type UsageStatsEvent
  = | { name: 'scene-play', data: { musicMode: MusicMode, music: number, ambience: number, effects: number, target: OutputTargetKind } }
    | { name: 'target-switch', data: { target: OutputTargetKind } }
    | { name: 'routed-tab-toggle', data: { routed: boolean, target: OutputTargetKind } }
    | { name: 'hotkey-fired', data: { kind: 'scene' | 'effect' | 'action' } }
    | { name: 'vision-analyze', data: { provider: VisionProviderId } }
    | { name: 'registry-install', data: { entryId: string } }

let currentRoutePattern: () => string = () => '/'

/** Lets every event carry the current view's route pattern; called once from `main.ts`. */
export function bindUsageStatsRouter(router: Router): void {
  currentRoutePattern = () => router.currentRoute.value.matched.at(-1)?.path ?? '/'
}

function requireElectron(): void {
  if (!useElectronApi())
    throw new Error('Electron API not available')
}

export function fetchUsageStats(): Promise<UsageStatsSettings> {
  requireElectron()
  return apiCall<UsageStatsSettings>('config', 'getUsageStats', [])
}

/** Switching on sends `app-start` straight away; switching off sends nothing. */
export function updateUsageStatsEnabled(enabled: boolean): Promise<UsageStatsSettings> {
  requireElectron()
  return apiCall<UsageStatsSettings>('config', 'setUsageStatsEnabled', [enabled])
}

export function markUsageStatsPrompted(): Promise<UsageStatsSettings> {
  requireElectron()
  return apiCall<UsageStatsSettings>('config', 'markUsageStatsPrompted', [])
}

/**
 * Fire-and-forget: hands the event to the backend with the current view's
 * route pattern (`/scenes/:id`, never the Scene id) and never throws. The
 * backend drops it unless Usage Stats are on.
 */
export function trackUsage(event: UsageStatsEvent): void {
  if (!useElectronApi())
    return
  const url = currentRoutePattern()
  apiCall<void>('usageStats', 'track', [
    { ...event, url },
  ])
    .catch(error => console.warn(`[usage-stats] Could not hand ${event.name} to the backend:`, error))
}
