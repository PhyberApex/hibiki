import { describeScheme, describeUrl, forwardMainFrameNavigation, guardBrowserTab, guardMainWindowNavigation, isTabUrl, isWebUrl, refuseDownloads, releaseOnMainFrameNavigation } from './navigation-guard'

const spies = {
  debug: jest.spyOn(console, 'debug').mockImplementation(() => {}),
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

describe('releaseOnMainFrameNavigation', () => {
  function listening(appUrl = 'hibiki://app/') {
    const release = jest.fn()
    return {
      listener: releaseOnMainFrameNavigation({ appUrl, release }),
      release,
    }
  }

  it('releases on a cross-document main-frame navigation within the app, such as a reload', () => {
    const { listener, release } = listening()

    listener({ url: 'hibiki://app/scenes', isMainFrame: true, isSameDocument: false })

    expect(release).toHaveBeenCalledTimes(1)
  })

  it('ignores same-document and subframe navigations', () => {
    const { listener, release } = listening()

    listener({ url: 'hibiki://app/settings', isMainFrame: true, isSameDocument: true })
    listener({ url: 'hibiki://app/frame', isMainFrame: false, isSameDocument: false })

    expect(release).not.toHaveBeenCalled()
  })

  // Chromium emits did-start-navigation before will-navigate, so these reach the listener before the guard cancels them (#707).
  it.each([
    'https://example.com/elsewhere?token=secret',
    'file:///home/gm/Downloads/page.html',
    'hibiki://sound/music/x',
    'not a url',
  ])('keeps everything on a navigation to %s, which the guard blocks', (url) => {
    const { listener, release } = listening()

    listener({ url, isMainFrame: true, isSameDocument: false })

    expect(release).not.toHaveBeenCalled()
    expect(spies.debug).toHaveBeenCalledWith('[window]', expect.stringContaining('Kept renderer resources'))
    expect(spies.debug.mock.calls.flat().join(' ')).not.toContain('secret')
  })

  it('releases on navigations within an http dev server the window loaded', () => {
    const { listener, release } = listening('http://localhost:5173/')

    listener({ url: 'http://localhost:5173/', isMainFrame: true, isSameDocument: false })
    listener({ url: 'http://localhost:5174/', isMainFrame: true, isSameDocument: false })

    expect(release).toHaveBeenCalledTimes(1)
  })
})

describe('isTabUrl', () => {
  it('accepts http(s) and the blank page a new tab opens on, nothing else', () => {
    expect(isTabUrl('https://www.dndbeyond.com/')).toBe(true)
    expect(isTabUrl('HTTP://example.com')).toBe(true)
    expect(isTabUrl('about:blank')).toBe(true)
    expect(isTabUrl('about:blank#x')).toBe(false)
    expect(isTabUrl('file:///etc/passwd')).toBe(false)
    expect(isTabUrl('hibiki://app/')).toBe(false)
    expect(isTabUrl('hibiki://sound/music/x.mp3')).toBe(false)
    expect(isTabUrl('javascript:alert(1)')).toBe(false)
    expect(isTabUrl(undefined)).toBe(false)
  })
})

describe('guardBrowserTab', () => {
  function fakeTab() {
    let openHandler: (details: { url: string }) => { action: string }
    const listeners = new Map<string, (event: { url: string, isMainFrame?: boolean, preventDefault: () => void }) => void>()
    const loadURL = jest.fn().mockResolvedValue(undefined)
    const webContents = {
      loadURL,
      setWindowOpenHandler: (handler: typeof openHandler) => { openHandler = handler },
      on: (name: string, listener: (event: { url: string, isMainFrame?: boolean, preventDefault: () => void }) => void) => {
        listeners.set(name, listener)
      },
    }
    guardBrowserTab(webContents, { tabId: 7 })
    const fire = (name: string, url: string, isMainFrame = true) => {
      const event = {
        url,
        isMainFrame,
        preventDefault: jest.fn(),
      }
      listeners.get(name)!(event)
      return event.preventDefault.mock.calls.length > 0
        ? 'blocked'
        : 'allowed'
    }
    return {
      loadURL,
      open: (url: string) => openHandler({ url }),
      navigate: (url: string) => fire('will-navigate', url),
      redirect: (url: string, isMainFrame = true) => fire('will-redirect', url, isMainFrame),
    }
  }

  it('opens an http(s) window.open in the same tab and never opens a window', () => {
    const tab = fakeTab()

    expect(tab.open('https://www.youtube.com/watch?v=x')).toEqual({ action: 'deny' })
    expect(tab.loadURL).toHaveBeenCalledWith('https://www.youtube.com/watch?v=x')
  })

  it.each([
    'file:///home/gm/.ssh/id_rsa',
    'hibiki://app/',
    'hibiki://sound/music/x.mp3',
    'javascript:alert(1)',
    'data:text/html,<p>hi</p>',
    'about:blank',
  ])('drops a window.open to %s and logs it', (url) => {
    const tab = fakeTab()

    expect(tab.open(url)).toEqual({ action: 'deny' })
    expect(tab.loadURL).not.toHaveBeenCalled()
    expect(spies.warn).toHaveBeenCalledWith('[browser]', expect.stringContaining('Tab 7 blocked a new window to'))
  })

  it('logs a failing load of an opened page instead of rejecting unhandled', async () => {
    const tab = fakeTab()
    tab.loadURL.mockRejectedValue(new Error('ERR_ABORTED'))

    tab.open('https://example.com/')
    await new Promise(resolve => setImmediate(resolve))

    expect(spies.debug).toHaveBeenCalledWith('[browser]', expect.stringContaining('Tab 7 could not load https://example.com'), expect.any(Error))
  })

  it('lets the tab navigate and redirect between web pages', () => {
    const tab = fakeTab()

    expect(tab.navigate('https://example.com/next')).toBe('allowed')
    expect(tab.redirect('https://cdn.example.com/page')).toBe('allowed')
    expect(tab.navigate('about:blank')).toBe('allowed')
  })

  it.each([
    'file:///C:/Users/gm/AppData/Roaming/discord/Local%20Storage/leveldb/000003.log',
    'hibiki://app/',
    'hibiki://sound/music/x.mp3',
  ])('blocks a navigation or redirect of the tab to %s', (url) => {
    const tab = fakeTab()

    expect(tab.navigate(url)).toBe('blocked')
    expect(tab.redirect(url)).toBe('blocked')
    expect(spies.warn).toHaveBeenCalledWith('[browser]', expect.stringContaining('Tab 7 blocked navigation to'))
    expect(spies.warn).toHaveBeenCalledWith('[browser]', expect.stringContaining('Tab 7 blocked a redirect to'))
  })

  it('leaves subframe redirects to the page', () => {
    const tab = fakeTab()

    expect(tab.redirect('data:text/html,ad', false)).toBe('allowed')
  })

  it('logs only the origin of a blocked URL, never its path or query', () => {
    const tab = fakeTab()

    tab.open('file:///home/gm/secret.txt')
    tab.navigate('hibiki://sound/music/secret.mp3')

    const logged = spies.warn.mock.calls.flat().join(' ')
    expect(logged).toContain('file:')
    expect(logged).not.toContain('secret')
  })
})

describe('refuseDownloads', () => {
  function withSession() {
    let listener: (event: { preventDefault: () => void }, item: { getURL: () => string }, webContents?: { id: number }) => void
    const session = {
      on: (name: string, l: typeof listener) => {
        if (name === 'will-download')
          listener = l
      },
    }
    refuseDownloads(session)
    return (url: string, webContents?: { id: number }) => {
      const event = {
        preventDefault: jest.fn(),
      }
      listener(event, {
        getURL: () => url,
      }, webContents)
      return event.preventDefault.mock.calls.length > 0
    }
  }

  it('cancels every download and logs where it came from without its path', () => {
    const download = withSession()

    expect(download('https://evil.example/payload.exe?token=secret', { id: 7 })).toBe(true)
    expect(download('blob:https://evil.example/uuid')).toBe(true)

    const logged = spies.warn.mock.calls.flat().join(' ')
    expect(logged).toContain('Refused a download from https://evil.example (web contents 7)')
    expect(logged).not.toContain('secret')
    expect(logged).not.toContain('payload')
  })
})
