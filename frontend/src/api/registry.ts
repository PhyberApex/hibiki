import { apiCall, useElectronApi } from './electron'

export interface SoundSource {
  name: string
  url?: string
  note?: string
}

export interface RegistryTrack {
  soundName: string
  volume?: number
  enabled?: boolean
  loop?: boolean
  source: SoundSource
}

export interface RegistryEntry {
  name: string
  slug: string
  description: string
  author: string
  version: string
  tags: string[]
  category: string
  license?: string
  audioBundled: false
  createdAt: string
  updatedAt: string
  scene: {
    music: RegistryTrack[]
    ambience: RegistryTrack[]
    effects: RegistryTrack[]
  }
}

export interface RegistryIndex {
  version: 1
  updatedAt: string
  scenes: RegistryEntry[]
}

function requireElectron(): void {
  if (!useElectronApi())
    throw new Error('Hibiki runs as an Electron app. Open it via pnpm run electron.')
}

export function getRegistryIndex(forceRefresh?: boolean): Promise<RegistryIndex> {
  requireElectron()
  return apiCall<RegistryIndex>('registry', 'getIndex', [forceRefresh])
}

export function installFromRegistry(slug: string): Promise<import('./scenes').Scene> {
  requireElectron()
  return apiCall<import('./scenes').Scene>('registry', 'installFromRegistry', [slug])
}
