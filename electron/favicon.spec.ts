import { isSafeFaviconUrl, MAX_FAVICON_URL_LENGTH, pickFavicon } from './favicon'

describe('isSafeFaviconUrl (#785)', () => {
  it.each([
    'https://example.com/favicon.ico',
    'data:image/png;base64,iVBORw0KGgo=',
  ])('accepts %s', (url) => {
    expect(isSafeFaviconUrl(url)).toBe(true)
  })

  it.each([
    'http://example.com/favicon.ico',
    'hibiki://sound/music/rain',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'nope',
    '',
    null,
  ])('refuses %s', (url) => {
    expect(isSafeFaviconUrl(url)).toBe(false)
  })

  it('refuses a URL longer than MAX_FAVICON_URL_LENGTH', () => {
    expect(isSafeFaviconUrl(`https://example.com/${'a'.repeat(MAX_FAVICON_URL_LENGTH)}`)).toBe(false)
  })
})

describe('pickFavicon (#785)', () => {
  it('picks the first safe favicon, skipping unsafe ones', () => {
    expect(pickFavicon(['http://example.com/a.ico', 'https://example.com/b.ico'])).toBe('https://example.com/b.ico')
  })

  it('is null when none is safe or the list is missing', () => {
    expect(pickFavicon(['javascript:alert(1)'])).toBeNull()
    expect(pickFavicon([])).toBeNull()
    expect(pickFavicon(undefined)).toBeNull()
  })
})
