import type { SceneItem } from '@/api/scenes'
import type { SoundFile } from '@/api/sounds'
import type { EffectSoundStatus } from '@/stores/player'

export type SceneCategory = 'ambience' | 'music' | 'effects'

/** The repeat intervals an Ambience item offers, in seconds. */
export const INTERVAL_OPTIONS = [
  0,
  5,
  10,
  15,
  20,
  30,
  45,
  60,
  90,
  120,
  180,
  300,
  600,
]

export function formatInterval(seconds: number): string {
  if (seconds === 0)
    return '0s'
  if (seconds < 60)
    return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s > 0
    ? `${m}m ${s}s`
    : `${m}m`
}

/** `m:ss` for an elapsed/total timer label (whole seconds, per #509's acceptance criteria). */
export function formatTimerSeconds(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Elapsed / total of an Effect's longest-remaining instance (#509) or the playing Music track (#695). */
export type TimerProgress = Pick<EffectSoundStatus, 'elapsedMs' | 'totalMs'>

/** `m:ss / m:ss` (elapsed / total). */
export function timerLabel(progress: TimerProgress): string {
  return `${formatTimerSeconds(progress.elapsedMs)} / ${formatTimerSeconds(progress.totalMs)}`
}

/** 0-100 fill percentage, or 0 while the duration isn't known yet. */
export function progressPercent(progress: TimerProgress): number {
  if (progress.totalMs <= 0)
    return 0
  return Math.min(100, (progress.elapsedMs / progress.totalMs) * 100)
}

/** The library name of `soundId`, or the id itself when the library has no such sound. */
export function libraryName(sounds: SoundFile[], soundId: string): string {
  return sounds.find(s => s.id === soundId)?.name ?? soundId
}

/** The name a Scene item shows: its stored name, else the library's. */
export function itemName(sounds: SoundFile[], item: SceneItem): string {
  return item.soundName ?? libraryName(sounds, item.soundId)
}

/** True when the library has no sound with this id (deleted, or a Scene imported without it). */
export function isMissingFrom(sounds: SoundFile[], soundId: string): boolean {
  return !sounds.some(s => s.id === soundId)
}
