import { isSafeFaviconUrl, MAX_FAVICON_URL_LENGTH, normalizeBookmarks, parseBookmarks } from './bookmarks'

const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

afterEach(() => jest.clearAllMocks())
afterAll(() => jest.restoreAllMocks())

describe('isSafeFaviconUrl (#785)', () => {
  it.each([
    'https://tabletopaudio.com/favicon.ico',
    'data:image/png;base64,iVBORw0KGgo=',
    'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
    'DATA:IMAGE/X-ICON;base64,AAAB',
  ])('accepts %s', (url) => {
    expect(isSafeFaviconUrl(url)).toBe(true)
  })

  it.each([
    ['plain http, which the CSP refuses anyway', 'http://example.com/favicon.ico'],
    ['javascript:', 'javascript:alert(1)'],
    ['a hibiki:// URL', 'hibiki://sound/music/rain'],
    ['a file: URL', 'file:///etc/passwd'],
    ['a non-image data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['an unparseable string', 'not a url'],
    ['an empty string', ''],
    ['a non-string', 42],
  ])('refuses %s', (_, url) => {
    expect(isSafeFaviconUrl(url)).toBe(false)
  })

  it('refuses a URL longer than MAX_FAVICON_URL_LENGTH', () => {
    const prefix = 'data:image/png;base64,'
    expect(isSafeFaviconUrl(prefix + 'A'.repeat(MAX_FAVICON_URL_LENGTH - prefix.length))).toBe(true)
    expect(isSafeFaviconUrl(prefix + 'A'.repeat(MAX_FAVICON_URL_LENGTH - prefix.length + 1))).toBe(false)
  })
})

describe('normalizeBookmarks (#785)', () => {
  it('keeps a bookmark and its safe favicon', () => {
    const bookmarks = [
      { name: 'Tabletop Audio', url: 'https://tabletopaudio.com', favicon: 'https://tabletopaudio.com/favicon.ico' },
    ]
    expect(normalizeBookmarks(bookmarks)).toEqual(bookmarks)
    expect(warn).not.toHaveBeenCalled()
  })

  it('keeps the bookmark but drops an unsafe favicon, logging how many were dropped', () => {
    expect(normalizeBookmarks([
      { name: 'Beacon', url: 'https://evil.example', favicon: 'http://evil.example/track.gif' },
      { name: 'Huge', url: 'https://huge.example', favicon: `data:image/png;base64,${'A'.repeat(MAX_FAVICON_URL_LENGTH)}` },
      { name: 'None', url: 'https://none.example' },
    ])).toEqual([
      { name: 'Beacon', url: 'https://evil.example' },
      { name: 'Huge', url: 'https://huge.example' },
      { name: 'None', url: 'https://none.example' },
    ])
    expect(warn).toHaveBeenCalledWith('[config]', expect.stringContaining('Dropped 2 bookmark favicon(s)'))
  })

  it('drops entries without a string name and URL, and anything that is not a list', () => {
    expect(normalizeBookmarks([
      null,
      'x',
      { name: 1, url: 'https://a.example' },
      { name: 'B', url: 'https://b.example' },
    ]))
      .toEqual([
        { name: 'B', url: 'https://b.example' },
      ])
    expect(normalizeBookmarks({ name: 'A' })).toEqual([])
  })
})

describe('parseBookmarks', () => {
  it('treats a missing or corrupt value as no bookmarks', () => {
    expect(parseBookmarks(null)).toEqual([])
    expect(parseBookmarks('{not json')).toEqual([])
  })

  it('normalises a stored list, so a favicon stored before #785 is dropped on load', () => {
    expect(parseBookmarks(JSON.stringify([
      { name: 'A', url: 'https://a.example', favicon: 'http://a.example/i.png' },
    ])))
      .toEqual([
        { name: 'A', url: 'https://a.example' },
      ])
  })
})
