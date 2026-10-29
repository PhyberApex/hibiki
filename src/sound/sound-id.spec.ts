import { isSafeSoundId, isSoundCategory } from './sound-id'

describe('isSafeSoundId', () => {
  it.each([
    'theme-1700000000000',
    'boss (phase 2)',
    'Tavern Song v1.2',
    'dragon_roar',
  ])('accepts the single path segment %j', (id) => {
    expect(isSafeSoundId(id)).toBe(true)
  })

  it.each([
    '',
    '.',
    '..',
    '../app-config',
    'a/b',
    'a\\b',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    'nul\0byte',
  ])('rejects %j', (id) => {
    expect(isSafeSoundId(id)).toBe(false)
  })

  it('rejects non-strings', () => {
    expect(isSafeSoundId(undefined)).toBe(false)
    expect(isSafeSoundId(42)).toBe(false)
  })
})

describe('sound categories', () => {
  it('knows the three Sound Library categories', () => {
    expect(['music', 'effects', 'ambience'].every(isSoundCategory)).toBe(true)
    expect(isSoundCategory('bogus')).toBe(false)
    expect(isSoundCategory('__proto__')).toBe(false)
  })
})
