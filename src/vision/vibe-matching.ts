import type { SoundFile } from '../sound/sound.types'

export interface VibeMatch {
  sound: SoundFile
  score: number
}

export const DEFAULT_MATCH_LIMIT = 5

function normalize(tag: string): string {
  return tag.trim().toLowerCase()
}

function overlaps(vibeTag: string, soundTag: string): boolean {
  return vibeTag.includes(soundTag) || soundTag.includes(vibeTag)
}

function scoreSound(vibeTags: string[], sound: SoundFile): number {
  const soundTags = sound.tags.map(normalize).filter(t => t.length > 0)
  if (soundTags.length === 0)
    return 0
  return vibeTags.filter(vibeTag => soundTags.some(soundTag => overlaps(vibeTag, soundTag))).length
}

export function matchVibeTags(vibeTags: string[], sounds: SoundFile[], limit = DEFAULT_MATCH_LIMIT): VibeMatch[] {
  const normalizedVibeTags = vibeTags.map(normalize).filter(t => t.length > 0)
  if (normalizedVibeTags.length === 0)
    return []
  return sounds
    .map(sound => ({ sound, score: scoreSound(normalizedVibeTags, sound) }))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score || b.sound.createdAt.localeCompare(a.sound.createdAt))
    .slice(0, limit)
}
