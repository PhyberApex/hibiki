import {
  DEFAULT_SCENE_FADE_LENGTH_SECONDS,
  normalizeSceneFadeLength,
  parseSceneFadeLength,
} from './scene-fade-settings'

describe('scene fade length settings', () => {
  it('defaults to 3 seconds', () => {
    expect(DEFAULT_SCENE_FADE_LENGTH_SECONDS).toBe(3)
  })

  it('parses missing or malformed stored values as the default', () => {
    expect(parseSceneFadeLength(null)).toBe(DEFAULT_SCENE_FADE_LENGTH_SECONDS)
    expect(parseSceneFadeLength('')).toBe(DEFAULT_SCENE_FADE_LENGTH_SECONDS)
    expect(parseSceneFadeLength('not json')).toBe(DEFAULT_SCENE_FADE_LENGTH_SECONDS)
    expect(parseSceneFadeLength('"a string"')).toBe(DEFAULT_SCENE_FADE_LENGTH_SECONDS)
  })

  it('parses a stored value', () => {
    expect(parseSceneFadeLength('4.5')).toBe(4.5)
    expect(parseSceneFadeLength('0')).toBe(0)
  })

  it('normalizes non-numbers and missing values to the default', () => {
    expect(normalizeSceneFadeLength(undefined)).toBe(DEFAULT_SCENE_FADE_LENGTH_SECONDS)
    expect(normalizeSceneFadeLength(null)).toBe(DEFAULT_SCENE_FADE_LENGTH_SECONDS)
    expect(normalizeSceneFadeLength('3' as never)).toBe(DEFAULT_SCENE_FADE_LENGTH_SECONDS)
    expect(normalizeSceneFadeLength(Number.NaN)).toBe(DEFAULT_SCENE_FADE_LENGTH_SECONDS)
    expect(normalizeSceneFadeLength(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SCENE_FADE_LENGTH_SECONDS)
  })

  it('clamps out-of-range values to 0–10', () => {
    expect(normalizeSceneFadeLength(-5)).toBe(0)
    expect(normalizeSceneFadeLength(15)).toBe(10)
  })

  it('snaps off-step values to the nearest 0.5', () => {
    expect(normalizeSceneFadeLength(2.2)).toBe(2)
    expect(normalizeSceneFadeLength(2.3)).toBe(2.5)
    expect(normalizeSceneFadeLength(0.24)).toBe(0)
    expect(normalizeSceneFadeLength(0.26)).toBe(0.5)
  })

  it('passes through valid on-step values unchanged', () => {
    for (const value of [0, 0.5, 1, 3, 9.5, 10])
      expect(normalizeSceneFadeLength(value)).toBe(value)
  })
})
