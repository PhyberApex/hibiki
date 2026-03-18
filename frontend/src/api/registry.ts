import { apiCall, useElectronApi } from './electron'

export interface RegistryEntry {
  name: string
  slug: string
  description: string
  author: string
  version: string
  tags: string[]
  category: string
  license?: string
  downloadUrl: string
  audioBundled: boolean
  createdAt: string
  updatedAt: string
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

export function installFromUrl(url: string): Promise<import('./scenes').Scene> {
  requireElectron()
  return apiCall<import('./scenes').Scene>('registry', 'installFromUrl', [url])
}
