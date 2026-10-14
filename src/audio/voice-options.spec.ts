import { resolveVoiceOptions } from './voice-options'

describe('resolveVoiceOptions', () => {
  it('keeps DAVE end-to-end encryption on by default', () => {
    expect(resolveVoiceOptions({}).daveEncryption).toBe(true)
    expect(resolveVoiceOptions({ HIBIKI_DAVE_ENCRYPTION: 'on' }).daveEncryption).toBe(true)
  })

  it('turns DAVE off only for the explicit "off" value, case-insensitively', () => {
    expect(resolveVoiceOptions({ HIBIKI_DAVE_ENCRYPTION: 'off' }).daveEncryption).toBe(false)
    expect(resolveVoiceOptions({ HIBIKI_DAVE_ENCRYPTION: ' OFF ' }).daveEncryption).toBe(false)
    expect(resolveVoiceOptions({ HIBIKI_DAVE_ENCRYPTION: 'false' }).daveEncryption).toBe(true)
  })
})
