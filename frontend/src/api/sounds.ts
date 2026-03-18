import { apiCall, useElectronApi } from './electron'

export interface SoundFile {
  id: string
  name: string
  filename: string
  category: string
  size?: number
  path?: string
  createdAt?: string
}

function requireElectron(): void {
  if (!useElectronApi())
    throw new Error('Hibiki runs as an Electron app. Open it via pnpm run electron.')
}

export function listMusic() {
  requireElectron()
  return apiCall<SoundFile[]>('sounds', 'listMusic', [])
}

export function listEffects() {
  requireElectron()
  return apiCall<SoundFile[]>('sounds', 'listEffects', [])
}

export function listAmbience() {
  requireElectron()
  return apiCall<SoundFile[]>('sounds', 'listAmbience', [])
}

export async function uploadSound(type: 'music' | 'effects' | 'ambience', file: File) {
  requireElectron()
  const buffer = await file.arrayBuffer()
  return apiCall<SoundFile>('sounds', 'uploadSound', [type, buffer, file.name])
}

/** Upload multiple files sequentially; returns results and any error per file. */
export async function uploadSoundsBulk(
  type: 'music' | 'effects' | 'ambience',
  files: File[],
): Promise<{ success: SoundFile[], failed: { file: File, error: Error }[] }> {
  const success: SoundFile[] = []
  const failed: { file: File, error: Error }[] = []
  for (const file of files) {
    try {
      const result = await uploadSound(type, file)
      success.push(result)
    }
    catch (err) {
      failed.push({ file, error: err instanceof Error ? err : new Error(String(err)) })
    }
  }
  return { success, failed }
}

export function deleteSound(type: 'music' | 'effects' | 'ambience', id: string) {
  requireElectron()
  return apiCall<void>('sounds', 'deleteSound', [type, id])
}

/** URL to stream a sound for playback (use in <audio src="...">) */
export function soundStreamUrl(type: 'music' | 'effects' | 'ambience', id: string): string {
  requireElectron()
  return `hibiki://sound/${type}/${encodeURIComponent(id)}`
}
