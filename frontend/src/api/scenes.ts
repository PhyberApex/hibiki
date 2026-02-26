import { apiCall, useElectronApi } from './electron'

export interface SceneItem {
  soundId: string
  soundName?: string
  volume?: number
  enabled?: boolean
  loop?: boolean
  repeatMin?: number
  repeatMax?: number
}

export interface Scene {
  id: string
  name: string
  ambience: SceneItem[]
  music: SceneItem[]
  effects: SceneItem[]
  createdAt: string
  updatedAt: string
}

function requireElectron(): void {
  if (!useElectronApi())
    throw new Error('Hibiki runs as an Electron app. Open it via pnpm run electron.')
}

export function listScenes(): Promise<Scene[]> {
  requireElectron()
  return apiCall<Scene[]>('scenes', 'list', [])
}

export function getScene(id: string): Promise<Scene | null> {
  requireElectron()
  return apiCall<Scene | null>('scenes', 'get', [id])
}

export function saveScene(scene: {
  id?: string
  name: string
  ambience?: SceneItem[]
  music?: SceneItem[]
  effects?: SceneItem[]
}): Promise<Scene> {
  requireElectron()
  const plain = JSON.parse(JSON.stringify(scene))
  return apiCall<Scene>('scenes', 'save', [plain])
}

export function deleteScene(id: string): Promise<void> {
  requireElectron()
  return apiCall<void>('scenes', 'remove', [id])
}

export function exportScene(id: string, targetDir: string): Promise<void> {
  requireElectron()
  return apiCall<void>('scenes', 'exportScene', [id, targetDir])
}

export function importScene(sourceDir: string): Promise<Scene> {
  requireElectron()
  return apiCall<Scene>('scenes', 'importScene', [sourceDir])
}
