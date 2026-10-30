import { describeScheme, describeUrl, forwardMainFrameNavigation, guardMainWindowNavigation, isWebUrl } from './navigation-guard'

const spies = {
  info: jest.spyOn(console, 'info').mockImplementation(() => {}),
  warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
}

afterEach(() => jest.clearAllMocks())

function fakeWebContents() {
  let openHandler: (details: { url: string }) => { action: string }
  let willNavigate: (event: { url: string, preventDefault: () => void }) => void
  return {
    setWindowOpenHandler: (handler: typeof openHandler) => { openHandler = handler },
    on: (name: string, listener: typeof willNavigate) => {
      if (name === 'will-navigate')
        willNavigate = listener
    },
    open: (url: string) => openHandler({ url }),
    navigate: (url: string) => {
      const event = {
        url,
        preventDefault: jest.fn(),
      }
      willNavigate(event)
      return event.preventDefault.mock.calls.length > 0
        ? 'blocked'
        : 'allowed'
    },
  }
}

function guarded(appUrl = 'hibiki://app/') {
  const webContents = fakeWebContents()
  const openExternal = jest.fn().mockResolvedValue(undefined)
  guardMainWindowNavigation(webContents, { appUrl, openExternal })
  return { webContents, openExternal }
}

describe('guardMainWindowNavigation', () => {
  it('sends http(s) window opens to the system browser and never opens a window', () => {
    const { webContents, openExternal } = guarded()

    expect(webContents.open('https://github.com/PhyberApex/hibiki')).toEqual({ action: 'deny' })
    expect(webContents.open('HTTP://example.com/a')).toEqual({ action: 'deny' })
    expect(openExternal.mock.calls).toEqual([
      ['https://github.com/PhyberApex/hibiki'],
      ['HTTP://example.com/a'],
    ])
  })

  it.each([
    'file:///etc/passwd',
    'hibiki://app/',
    'javascript:alert(1)',
    'not a url',
  ])('denies a window open to %s without opening it', (url) => {
    const { webContents, openExternal } = guarded()

    expect(webContents.open(url)).toEqual({ action: 'deny' })
    expect(openExternal).not.toHaveBeenCalled()
    expect(spies.warn).toHaveBeenCalledWith('[window]', expect.stringContaining('Blocked a new window to'))
  })

  it('logs a failing openExternal instead of rejecting unhandled', async () => {
    const webContents = fakeWebContents()
    const openExternal = jest.fn().mockRejectedValue(new Error('no browser'))
    guardMainWindowNavigation(webContents, { appUrl: 'hibiki://app/', openExternal })

    webContents.open('https://example.com/')
    await new Promise(resolve => setImmediate(resolve))

    expect(spies.warn).toHaveBeenCalledWith('[window]', 'Could not open https://example.com in the system browser', expect.any(Error))
  })

  it('allows navigation within the app it loaded', () => {
    const { webContents } = guarded()

    expect(webContents.navigate('hibiki://app/')).toBe('allowed')
    expect(webContents.navigate('hibiki://app/settings')).toBe('allowed')
  })

  it.each([
    'https://evil.example/page',
    'file:///home/gm/Downloads/page.html',
    'hibiki://sound/music/x',
    'hibiki://app.evil/',
    'data:text/html,<p>hi</p>',
  ])('blocks navigation of the main window to %s', (url) => {
    const { webContents } = guarded()

    expect(webContents.navigate(url)).toBe('blocked')
    expect(spies.warn).toHaveBeenCalledWith('[window]', expect.stringContaining('Blocked navigation of the main window to'))
  })

  it('keeps an http dev server navigable when the window loaded one', () => {
    const { webContents } = guarded('http://localhost:5173/')

    expect(webContents.navigate('http://localhost:5173/settings')).toBe('allowed')
    expect(webContents.navigate('http://localhost:5174/')).toBe('blocked')
  })

  it('logs only the origin of a blocked URL, never its path or query', () => {
    const { webContents } = guarded()

    webContents.navigate('https://evil.example/cb?token=secret')
    webContents.open('file:///home/gm/secret.html')

    const logged = spies.warn.mock.calls.flat().join(' ')
    expect(logged).toContain('https://evil.example')
    expect(logged).toContain('file:')
    expect(logged).not.toContain('secret')
  })
})

describe('describeUrl', () => {
  it('reduces a URL to its origin, or its scheme when it has none', () => {
    expect(describeUrl('https://example.com:8443/a?b=c')).toBe('https://example.com:8443')
    expect(describeUrl('file:///etc/passwd')).toBe('file:')
    expect(describeUrl('nonsense')).toBe('an unparseable URL')
  })
})

describe('describeScheme', () => {
  it('reduces a URL to its scheme alone', () => {
    expect(describeScheme('ftp://host.example/secret')).toBe('ftp:')
    expect(describeScheme('file:///home/gm/secret.txt')).toBe('file:')
    expect(describeScheme(42)).toBe('an unparseable URL')
  })
})

describe('isWebUrl', () => {
  it('accepts only http(s) URLs', () => {
    expect(isWebUrl('https://example.com')).toBe(true)
    expect(isWebUrl('HTTP://example.com')).toBe(true)
    expect(isWebUrl('file:///etc/passwd')).toBe(false)
    expect(isWebUrl('https:evil')).toBe(false)
    expect(isWebUrl(42)).toBe(false)
  })
})

describe('forwardMainFrameNavigation', () => {
  it('forwards main-frame URLs from the details object and ignores subframes', () => {
    const send = jest.fn()
    const listener = forwardMainFrameNavigation(send)

    listener({ url: 'https://dndbeyond.com/', isMainFrame: true })
    listener({ url: 'https://ads.example/frame', isMainFrame: false })

    expect(send.mock.calls).toEqual([
      ['https://dndbeyond.com/'],
    ])
  })
})
