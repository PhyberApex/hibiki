import { describe, expect, it } from 'vitest'
import { DIALOG_TEXT_MAX_LENGTH, dialogSafeText } from './dialog-text'

describe('dialogSafeText (#785)', () => {
  it('leaves an ordinary name alone', () => {
    expect(dialogSafeText('Goblin Ambush')).toBe('Goblin Ambush')
  })

  it('folds newlines and other control characters into single spaces', () => {
    expect(dialogSafeText('Tavern"?\n\nThis scene is protected.\r\nClick OK to keep it.')).toBe('Tavern"? This scene is protected. Click OK to keep it.')
    expect(dialogSafeText('a\u0000b\tc\u2028d')).toBe('a b c d')
  })

  it('strips bidi overrides that could reorder the prompt', () => {
    expect(dialogSafeText('evil\u202Etxt.exe')).toBe('evil txt.exe')
  })

  it('truncates to the cap with an ellipsis', () => {
    const result = dialogSafeText('x'.repeat(200))
    expect([...result]).toHaveLength(DIALOG_TEXT_MAX_LENGTH)
    expect(result.endsWith('…')).toBe(true)
  })
})
