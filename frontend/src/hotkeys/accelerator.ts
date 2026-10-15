const MODIFIER_CODES = new Set(['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'AltGraph'])

const NAMED_CODES: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: '\'',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
  MediaPlayPause: 'MediaPlayPause',
  MediaStop: 'MediaStop',
  MediaTrackNext: 'MediaNextTrack',
  MediaTrackPrevious: 'MediaPreviousTrack',
}

function keyName(code: string): string | undefined {
  if (/^Key[A-Z]$/.test(code))
    return code.slice(3)
  if (/^Digit\d$/.test(code))
    return code.slice(5)
  if (/^F\d{1,2}$/.test(code))
    return code
  if (/^Numpad\d$/.test(code))
    return `num${code.slice(6)}`
  return NAMED_CODES[code]
}

export type KeyEventLike = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>

/**
 * Turns a keydown into an Electron accelerator string, or undefined while only modifiers are held
 * (or for a key Electron has no name for). Uses the physical key so Shift+1 stays "Shift+1".
 */
export function acceleratorFromEvent(event: KeyEventLike): string | undefined {
  if (MODIFIER_CODES.has(event.code))
    return undefined
  const key = keyName(event.code)
  if (!key)
    return undefined
  const parts: string[] = []
  if (event.ctrlKey)
    parts.push('Ctrl')
  if (event.altKey)
    parts.push('Alt')
  if (event.shiftKey)
    parts.push('Shift')
  if (event.metaKey)
    parts.push('Super')
  parts.push(key)
  return parts.join('+')
}

/** A bare letter or digit (Shift at most) would be stolen from every other app while Hibiki runs. */
export function isBareTypingKey(accelerator: string): boolean {
  const parts = accelerator.split('+')
  const key = parts[parts.length - 1]
  const modifiers = parts.slice(0, -1).filter(m => m !== 'Shift')
  return modifiers.length === 0 && /^[A-Z0-9]$/i.test(key)
}
