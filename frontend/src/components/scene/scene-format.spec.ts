import { describe, expect, it } from 'vitest'
import { formatInterval, isMissingFrom, itemName, progressPercent, timerLabel } from './scene-format'

const library = [
  {
    id: 'amb-1',
    name: 'Rain',
    filename: 'rain.mp3',
    category: 'ambience',
  },
]

describe('scene-format', () => {
  it('formats repeat intervals as seconds below a minute and minutes from there', () => {
    expect(formatInterval(0)).toBe('0s')
    expect(formatInterval(45)).toBe('45s')
    expect(formatInterval(60)).toBe('1m')
    expect(formatInterval(90)).toBe('1m 30s')
  })

  it('labels elapsed / total in whole m:ss', () => {
    expect(timerLabel({ elapsedMs: 5_999, totalMs: 125_000 })).toBe('0:05 / 2:05')
  })

  it('fills 0% while the duration is unknown and never past 100%', () => {
    expect(progressPercent({ elapsedMs: 1_000, totalMs: 0 })).toBe(0)
    expect(progressPercent({ elapsedMs: 1_000, totalMs: 4_000 })).toBe(25)
    expect(progressPercent({ elapsedMs: 5_000, totalMs: 4_000 })).toBe(100)
  })

  it('names an item by its stored name, then the library, then its id', () => {
    expect(itemName(library, { soundId: 'amb-1', soundName: 'Storm rain' })).toBe('Storm rain')
    expect(itemName(library, { soundId: 'amb-1' })).toBe('Rain')
    expect(itemName(library, { soundId: 'gone' })).toBe('gone')
  })

  it('flags a sound missing only when the library lacks it', () => {
    expect(isMissingFrom(library, 'amb-1')).toBe(false)
    expect(isMissingFrom(library, 'gone')).toBe(true)
  })
})
