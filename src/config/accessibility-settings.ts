export interface AccessibilitySettings {
  luminancePulses: boolean
  /** `null` follows the OS `prefers-reduced-motion` setting. */
  reduceMotion: boolean | null
}

export const DEFAULT_ACCESSIBILITY_SETTINGS: AccessibilitySettings = {
  luminancePulses: true,
  reduceMotion: null,
}

export function normalizeAccessibilitySettings(input: Partial<AccessibilitySettings> | null | undefined): AccessibilitySettings {
  const source = typeof input === 'object' && input !== null ? input : {}
  return {
    luminancePulses: typeof source.luminancePulses === 'boolean'
      ? source.luminancePulses
      : DEFAULT_ACCESSIBILITY_SETTINGS.luminancePulses,
    reduceMotion: typeof source.reduceMotion === 'boolean'
      ? source.reduceMotion
      : DEFAULT_ACCESSIBILITY_SETTINGS.reduceMotion,
  }
}

export function parseAccessibilitySettings(raw: string | null): AccessibilitySettings {
  if (!raw)
    return { ...DEFAULT_ACCESSIBILITY_SETTINGS }
  try {
    return normalizeAccessibilitySettings(JSON.parse(raw))
  }
  catch {
    return { ...DEFAULT_ACCESSIBILITY_SETTINGS }
  }
}
