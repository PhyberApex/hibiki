import type { OutputTargetKind } from '../player/output-target'
import { createLogger } from '../logger'
import { normalizeMasterVolume, parseMasterVolume } from './master-volume-settings'

const log = createLogger('config')

const ACTIVE_TARGET_KEY = 'output.activeTarget'
/** Pre-Output-Target single master volume; it belonged to the Discord Target, so it migrates there. */
const LEGACY_MASTER_VOLUME_KEY = 'player.masterVolume'

export interface OutputTargetStore {
  get: (key: string) => Promise<string | null | undefined>
  set: (key: string, value: string) => Promise<void>
}

export function normalizeOutputTargetKind(input: unknown): OutputTargetKind | null {
  return input === 'local' || input === 'discord' ? input : null
}

/** Master volume is stored per Target kind: every Discord guild shares the Discord Target's value. */
function masterVolumeKey(kind: OutputTargetKind): string {
  return `player.masterVolume.${kind}`
}

export function createOutputTargetSettings(store: OutputTargetStore, hasDiscordToken: () => Promise<boolean>) {
  async function getActive(): Promise<OutputTargetKind> {
    const raw = await store.get(ACTIVE_TARGET_KEY)
    if (raw) {
      try {
        const stored = normalizeOutputTargetKind(JSON.parse(raw))
        if (stored)
          return stored
      }
      catch {
        // fall through to the default
      }
    }
    return (await hasDiscordToken()) ? 'discord' : 'local'
  }

  async function setActive(kind: unknown): Promise<void> {
    const normalized = normalizeOutputTargetKind(kind)
    if (!normalized)
      throw new Error(`Unknown output target: ${String(kind)}`)
    await store.set(ACTIVE_TARGET_KEY, JSON.stringify(normalized))
    log.info(`Active output target set to ${normalized}`)
  }

  async function getMasterVolume(kind: OutputTargetKind): Promise<number> {
    const raw = await store.get(masterVolumeKey(kind))
    if (raw)
      return parseMasterVolume(raw)
    if (kind === 'discord') {
      const legacy = await store.get(LEGACY_MASTER_VOLUME_KEY)
      if (legacy) {
        const migrated = parseMasterVolume(legacy)
        await store.set(masterVolumeKey('discord'), JSON.stringify(migrated))
        log.info(`Migrated master volume ${migrated} to the discord output target`)
        return migrated
      }
    }
    return parseMasterVolume(null)
  }

  async function setMasterVolume(kind: OutputTargetKind, volume: unknown): Promise<void> {
    const normalized = normalizeMasterVolume(volume)
    await store.set(masterVolumeKey(kind), JSON.stringify(normalized))
    log.info(`Master volume for ${kind} output target set to ${normalized}`)
  }

  return { getActive, setActive, getMasterVolume, setMasterVolume }
}
