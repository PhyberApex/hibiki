export const DEFAULT_SCENE_FADE_LENGTH_SECONDS = 3
export const MIN_SCENE_FADE_LENGTH_SECONDS = 0
export const MAX_SCENE_FADE_LENGTH_SECONDS = 10
export const SCENE_FADE_LENGTH_STEP_SECONDS = 0.5

export function normalizeSceneFadeLength(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input))
    return DEFAULT_SCENE_FADE_LENGTH_SECONDS
  const clamped = Math.min(MAX_SCENE_FADE_LENGTH_SECONDS, Math.max(MIN_SCENE_FADE_LENGTH_SECONDS, input))
  return Math.round(clamped / SCENE_FADE_LENGTH_STEP_SECONDS) * SCENE_FADE_LENGTH_STEP_SECONDS
}

export function parseSceneFadeLength(raw: string | null): number {
  if (!raw)
    return DEFAULT_SCENE_FADE_LENGTH_SECONDS
  try {
    return normalizeSceneFadeLength(JSON.parse(raw))
  }
  catch {
    return DEFAULT_SCENE_FADE_LENGTH_SECONDS
  }
}
