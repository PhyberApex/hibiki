import {
  DEFAULT_MASTER_VOLUME,
  normalizeMasterVolume,
  parseMasterVolume,
} from './master-volume-settings'

describe('master volume settings', () => {
  it('defaults to 80', () => {
    expect(DEFAULT_MASTER_VOLUME).toBe(80)
  })

  it('parses missing or malformed stored values as the default', () => {
    expect(parseMasterVolume(null)).toBe(DEFAULT_MASTER_VOLUME)
    expect(parseMasterVolume('')).toBe(DEFAULT_MASTER_VOLUME)
    expect(parseMasterVolume('not json')).toBe(DEFAULT_MASTER_VOLUME)
    expect(parseMasterVolume('"a string"')).toBe(DEFAULT_MASTER_VOLUME)
  })

  it('parses a stored value', () => {
    expect(parseMasterVolume('42')).toBe(42)
    expect(parseMasterVolume('0')).toBe(0)
  })

  it('normalizes non-numbers and missing values to the default', () => {
    expect(normalizeMasterVolume(undefined)).toBe(DEFAULT_MASTER_VOLUME)
    expect(normalizeMasterVolume(null)).toBe(DEFAULT_MASTER_VOLUME)
    expect(normalizeMasterVolume('80' as never)).toBe(DEFAULT_MASTER_VOLUME)
    expect(normalizeMasterVolume(Number.NaN)).toBe(DEFAULT_MASTER_VOLUME)
    expect(normalizeMasterVolume(Number.POSITIVE_INFINITY)).toBe(DEFAULT_MASTER_VOLUME)
  })

  it('clamps out-of-range values to 0-100', () => {
    expect(normalizeMasterVolume(-5)).toBe(0)
    expect(normalizeMasterVolume(150)).toBe(100)
  })

  it('rounds fractional values', () => {
    expect(normalizeMasterVolume(42.4)).toBe(42)
    expect(normalizeMasterVolume(42.6)).toBe(43)
  })

  it('passes through valid integers unchanged', () => {
    for (const value of [0, 1, 42, 80, 100])
      expect(normalizeMasterVolume(value)).toBe(value)
  })
})
