import type { SoundCategory } from './sound.types'
import { parse } from 'node:path'

export const SOUND_CATEGORIES: readonly SoundCategory[] = ['music', 'effects', 'ambience']

export function isSoundCategory(value: unknown): value is SoundCategory {
  return typeof value === 'string' && (SOUND_CATEGORIES as readonly string[]).includes(value)
}

/**
 * A sound id is a file's name without its extension, so it must be exactly one
 * path segment: no separators, no `.`/`..`, no NUL. Anything else could walk
 * out of the category directory when globbed or joined (#637). Spaces, dots
 * and brackets stay allowed because GMs drop arbitrary files into the folders.
 */
export function isSafeSoundId(id: unknown): id is string {
  return typeof id === 'string'
    && id.length > 0
    && id !== '.'
    && id !== '..'
    && !/[/\\\0]/.test(id)
}

/**
 * The sound id of a library file: its name with only the trailing extension
 * removed, so `rain.wav-mix.wav` is `rain.wav-mix` (#662).
 */
export function idFromFilename(filename: string): string {
  return parse(filename).name
}
