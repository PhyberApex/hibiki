export const DEFAULT_MASTER_VOLUME = 80
export const MIN_MASTER_VOLUME = 0
export const MAX_MASTER_VOLUME = 100

export function normalizeMasterVolume(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input))
    return DEFAULT_MASTER_VOLUME
  return Math.round(Math.min(MAX_MASTER_VOLUME, Math.max(MIN_MASTER_VOLUME, input)))
}

export function parseMasterVolume(raw: string | null): number {
  if (!raw)
    return DEFAULT_MASTER_VOLUME
  try {
    return normalizeMasterVolume(JSON.parse(raw))
  }
  catch {
    return DEFAULT_MASTER_VOLUME
  }
}
