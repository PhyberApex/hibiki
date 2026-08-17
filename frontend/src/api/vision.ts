import type { SoundFile } from './sounds'
import { apiCall, useElectronApi } from './electron'

export interface VibeAnalysis {
  description: string
  tags: string[]
}

export interface VibeMatch {
  sound: SoundFile
  score: number
}

export interface VibeMatches {
  music: VibeMatch[]
  ambience: VibeMatch[]
}

function requireElectron(): void {
  if (!useElectronApi())
    throw new Error('Hibiki runs as an Electron app. Open it via pnpm run electron.')
}

export function analyzeImageVibe(imagePath: string): Promise<VibeAnalysis> {
  requireElectron()
  return apiCall<VibeAnalysis>('vision', 'analyzeImageVibe', [imagePath])
}

export function matchVibe(vibeTags: string[]): Promise<VibeMatches> {
  requireElectron()
  return apiCall<VibeMatches>('vision', 'matchVibe', [vibeTags])
}
