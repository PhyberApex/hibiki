import type { MusicMode } from '@/api/scenes'

/**
 * Pure track selection for a Scene's Music Mode (CONTEXT.md, ADR-0006). The
 * scene playback store owns the state (current track, its list index, the
 * shuffle bag) and feeds the Scene's live Music list in at each advance; this
 * module only decides which track comes next.
 */

const MUSIC_MODES: readonly MusicMode[] = ['single', 'sequential', 'shuffle']

/** Absent or unknown values read as `single`, matching `src/scenes/scene-store.ts#normalizeMusicMode`. */
export function normalizeMusicMode(raw: unknown): MusicMode {
  return MUSIC_MODES.includes(raw as MusicMode) ? raw as MusicMode : 'single'
}

/** The chosen track, its index in the list it was picked from, and the shuffle bag left after it (empty outside shuffle). */
export interface SelectedTrack {
  soundId: string
  index: number
  bag: string[]
}

export interface NextTrackInput {
  mode: MusicMode
  /** The Scene's Music soundIds, in list order, as they are right now. */
  list: readonly string[]
  /** The track that just played out (or failed to start). */
  current: string | null
  /** `current`'s index when it was picked, so a removed track still has a position. */
  currentIndex: number
  /** Shuffle: tracks not yet played this pass. */
  bag: readonly string[]
  random?: () => number
}

function shuffled(ids: readonly string[], random: () => number): string[] {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** A fresh shuffle bag of every track in `list` except `exclude` (the one already playing). */
export function shuffleBagWithout(list: readonly string[], exclude: string | null, random: () => number = Math.random): string[] {
  return shuffled([...new Set(list)].filter(id => id !== exclude), random)
}

/** The track a Scene's Music starts with: the first in single and sequential, a random one (with a fresh bag) in shuffle. */
export function selectFirstTrack(mode: MusicMode, list: readonly string[], random: () => number = Math.random): SelectedTrack | null {
  if (list.length === 0)
    return null
  if (mode !== 'shuffle')
    return { soundId: list[0]!, index: 0, bag: [] }
  const [first, ...bag] = shuffled([...new Set(list)], random)
  return { soundId: first!, index: list.indexOf(first!), bag }
}

/** The track to advance to once `current` has played out, or null when nothing should follow (single mode, empty list). */
export function selectNextTrack(input: NextTrackInput): SelectedTrack | null {
  const { mode, list, current, currentIndex, bag } = input
  const random = input.random ?? Math.random
  if (mode === 'single' || list.length === 0)
    return null

  if (mode === 'sequential') {
    const at = current !== null && list[currentIndex] === current ? currentIndex : list.indexOf(current ?? '')
    // A removed current track: whatever slid into its slot plays next.
    const index = at >= 0 ? (at + 1) % list.length : Math.max(0, currentIndex) % list.length
    return { soundId: list[index]!, index, bag: [] }
  }

  const live = new Set(list)
  const remaining = bag.filter(id => live.has(id) && id !== current)
  if (remaining.length > 0) {
    const [next, ...rest] = remaining
    return { soundId: next!, index: list.indexOf(next!), bag: rest }
  }
  // New pass: reshuffle, never opening with the track that just played.
  const pass = shuffled([...live], random)
  if (pass.length > 1 && pass[0] === current) {
    const swap = 1 + Math.floor(random() * (pass.length - 1))
    ;[pass[0], pass[swap]] = [pass[swap]!, pass[0]!]
  }
  const [next, ...rest] = pass
  return { soundId: next!, index: list.indexOf(next!), bag: rest }
}
