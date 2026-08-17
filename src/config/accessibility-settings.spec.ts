import {
  DEFAULT_ACCESSIBILITY_SETTINGS,
  normalizeAccessibilitySettings,
  parseAccessibilitySettings,
} from './accessibility-settings'

describe('accessibility settings', () => {
  it('defaults to pulses on and reduce-motion following the OS', () => {
    expect(DEFAULT_ACCESSIBILITY_SETTINGS).toEqual({ luminancePulses: true, reduceMotion: null })
  })

  it('parses missing or malformed stored values as defaults', () => {
    expect(parseAccessibilitySettings(null)).toEqual(DEFAULT_ACCESSIBILITY_SETTINGS)
    expect(parseAccessibilitySettings('')).toEqual(DEFAULT_ACCESSIBILITY_SETTINGS)
    expect(parseAccessibilitySettings('not json')).toEqual(DEFAULT_ACCESSIBILITY_SETTINGS)
    expect(parseAccessibilitySettings('"a string"')).toEqual(DEFAULT_ACCESSIBILITY_SETTINGS)
  })

  it('parses a stored JSON payload', () => {
    expect(parseAccessibilitySettings('{"luminancePulses":false,"reduceMotion":true}'))
      .toEqual({ luminancePulses: false, reduceMotion: true })
  })

  it('falls back per field when a stored field has the wrong type', () => {
    expect(parseAccessibilitySettings('{"luminancePulses":"nope","reduceMotion":"yes"}'))
      .toEqual(DEFAULT_ACCESSIBILITY_SETTINGS)
    expect(parseAccessibilitySettings('{"reduceMotion":false}'))
      .toEqual({ luminancePulses: true, reduceMotion: false })
  })

  it('normalizes arbitrary input into a well-typed settings object', () => {
    expect(normalizeAccessibilitySettings({ luminancePulses: false, reduceMotion: null }))
      .toEqual({ luminancePulses: false, reduceMotion: null })
    expect(normalizeAccessibilitySettings({ luminancePulses: 1, reduceMotion: 'x' } as never))
      .toEqual(DEFAULT_ACCESSIBILITY_SETTINGS)
    expect(normalizeAccessibilitySettings(undefined as never))
      .toEqual(DEFAULT_ACCESSIBILITY_SETTINGS)
  })
})
