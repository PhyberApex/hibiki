import { describe, expect, it } from 'vitest'
import { acceleratorFromEvent, isBareTypingKey } from './accelerator'

function key(code: string, mods: Partial<{ ctrlKey: boolean, altKey: boolean, shiftKey: boolean, metaKey: boolean }> = {}) {
  return { code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }
}

describe('acceleratorFromEvent', () => {
  it('is undefined while only a modifier is held', () => {
    expect(acceleratorFromEvent(key('ShiftLeft', { shiftKey: true }))).toBeUndefined()
    expect(acceleratorFromEvent(key('AltGraph'))).toBeUndefined()
  })

  it('is undefined for a key Electron has no name for', () => {
    expect(acceleratorFromEvent(key('IntlBackslash'))).toBeUndefined()
  })

  it.each([
    ['KeyA', 'A'],
    ['Digit1', '1'],
    ['F5', 'F5'],
    ['F24', 'F24'],
    ['Numpad7', 'num7'],
    ['NumpadAdd', 'numadd'],
    ['NumpadEnter', 'Enter'],
    ['ArrowUp', 'Up'],
    ['Slash', '/'],
    ['MediaTrackNext', 'MediaNextTrack'],
  ])('names %s as %s', (code, name) => {
    expect(acceleratorFromEvent(key(code))).toBe(name)
  })

  it('orders modifiers Ctrl, Alt, Shift, Super before the key', () => {
    expect(acceleratorFromEvent(key('KeyK', { metaKey: true, shiftKey: true, altKey: true, ctrlKey: true })))
      .toBe('Ctrl+Alt+Shift+Super+K')
  })

  it('keeps the physical key under Shift', () => {
    expect(acceleratorFromEvent(key('Digit1', { shiftKey: true }))).toBe('Shift+1')
  })
})

describe('isBareTypingKey', () => {
  it.each(['A', 'z', '7', 'Shift+A', 'Shift+3'])('flags %s', (accelerator) => {
    expect(isBareTypingKey(accelerator)).toBe(true)
  })

  it.each(['Ctrl+A', 'Alt+Shift+1', 'F13', 'Space', 'num5', 'Super+Q'])('allows %s', (accelerator) => {
    expect(isBareTypingKey(accelerator)).toBe(false)
  })
})
