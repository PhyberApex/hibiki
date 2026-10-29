import { parseSoundPath, SOUND_ALLOWED_ORIGIN } from './sound-url'

describe('parseSoundPath', () => {
  it('decodes the id of a sound URL', () => {
    expect(parseSoundPath('/music/boss%20(phase%202)')).toEqual({ ok: true, type: 'music', id: 'boss (phase 2)' })
    expect(parseSoundPath('/effects/door-1700000000000')).toEqual({ ok: true, type: 'effects', id: 'door-1700000000000' })
  })

  it.each([
    '/music/..%2F..%2Fdata%2Fapp-config',
    '/music/..%2F..%2Flogs%2Fhibiki',
    '/music/..%5C..%5Cdata%5Capp-config',
    '/music/%2Fetc%2Fpasswd',
    '/music/..',
    '/music/%2E%2E',
    '/music/nul%00byte',
  ])('rejects the traversal %s', (pathname) => {
    expect(parseSoundPath(pathname)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('unsafe id'),
    })
  })

  it('rejects an unknown type, a missing id and extra segments', () => {
    expect(parseSoundPath('/bogus/rain')).toMatchObject({ ok: false })
    expect(parseSoundPath('/music')).toMatchObject({ ok: false })
    expect(parseSoundPath('/music/a/b')).toMatchObject({ ok: false })
    expect(parseSoundPath('')).toMatchObject({ ok: false })
  })

  it('rejects a malformed escape instead of throwing', () => {
    expect(parseSoundPath('/music/%E0%A4%A')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('malformed'),
    })
  })

  it('only lets the app renderer read sound responses', () => {
    expect(SOUND_ALLOWED_ORIGIN).toBe('hibiki://app')
  })
})
