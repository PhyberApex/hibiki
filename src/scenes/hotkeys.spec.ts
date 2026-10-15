import { normalizeAccelerator, normalizeOptionalAccelerator } from './hotkeys'

describe('normalizeAccelerator', () => {
  it('ignores case and modifier order', () => {
    expect(normalizeAccelerator('shift+ctrl+a')).toBe('Ctrl+Shift+A')
    expect(normalizeAccelerator('Ctrl+Shift+A')).toBe('Ctrl+Shift+A')
    expect(normalizeAccelerator('f13')).toBe('F13')
  })

  it('resolves modifier and key aliases', () => {
    expect(normalizeAccelerator('CommandOrControl+Esc')).toBe('CmdOrCtrl+Escape')
    expect(normalizeAccelerator('cmdorctrl+Escape')).toBe('CmdOrCtrl+Escape')
    expect(normalizeAccelerator('Option+Return')).toBe('Alt+Enter')
  })

  it('keeps the camel-cased spelling of multi-word keys', () => {
    expect(normalizeAccelerator('ctrl+pageup')).toBe('Ctrl+PageUp')
    expect(normalizeAccelerator('mediaplaypause')).toBe('MediaPlayPause')
  })

  it('collapses duplicate modifiers and keeps a literal plus key', () => {
    expect(normalizeAccelerator('Ctrl+ctrl+X')).toBe('Ctrl+X')
    expect(normalizeAccelerator('Ctrl++')).toBe('Ctrl++')
  })

  it('rejects malformed accelerators', () => {
    expect(() => normalizeAccelerator('Ctrl+')).toThrow('Invalid hotkey')
    expect(() => normalizeAccelerator('Ctrl+Shift')).toThrow('missing a key')
    expect(() => normalizeAccelerator('Banana+A')).toThrow('unknown modifier')
  })
})

describe('normalizeOptionalAccelerator', () => {
  it('treats empty values as no hotkey', () => {
    expect(normalizeOptionalAccelerator(undefined)).toBeUndefined()
    expect(normalizeOptionalAccelerator('  ')).toBeUndefined()
    expect(() => normalizeOptionalAccelerator(5)).toThrow('must be a string')
  })
})
