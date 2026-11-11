import type { SoundCategory } from './sound.types'
import { parse } from 'node:path'

export const SOUND_CATEGORIES: readonly SoundCategory[] = ['music', 'effects', 'ambience']

/**
 * Extensions a sound file from a Scene package may carry (#785): every format
 * with a backend decoder (ADR-0003) plus the ones only the renderer fallback
 * plays (Chromium's audio containers, which an `audio/*` upload may carry).
 * A file with none of them is never written into the library.
 */
export const SOUND_FILE_EXTENSIONS: readonly string[] = [
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.oga',
  '.opus',
  '.m4a',
  '.aac',
  '.mp4',
  '.webm',
  '.weba',
]

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
