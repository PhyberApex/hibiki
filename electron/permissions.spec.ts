import { createPermissionPolicy, installPermissionPolicy } from './permissions'

const spies = {
  info: jest.spyOn(console, 'info').mockImplementation(() => {}),
  warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
}

afterEach(() => jest.clearAllMocks())

/** What the request handler answered for `permission` asked by a frame on `requestingUrl`. */
function request(permission: string, requestingUrl: string) {
  const { requestHandler } = createPermissionPolicy()
  const callback = jest.fn()
  requestHandler({}, permission, callback, { requestingUrl })
  expect(callback).toHaveBeenCalledTimes(1)
  return callback.mock.calls[0][0]
}

describe('permission request handler', () => {
  it.each(['media', 'speaker-selection'])('grants %s to the app renderer', (permission) => {
    expect(request(permission, 'hibiki://app/browser')).toBe(true)
    expect(spies.warn).not.toHaveBeenCalled()
  })

  it.each([
    'media',
    'speaker-selection',
    'geolocation',
    'notifications',
    'clipboard-read',
  ])('denies %s to a Browser tab page and logs it', (permission) => {
    expect(request(permission, 'https://evil.example/page?token=secret')).toBe(false)
    expect(spies.warn).toHaveBeenCalledWith('[permissions]', `Denied ${permission} to https://evil.example`)
  })

  it.each(['geolocation', 'notifications', 'clipboard-read'])('denies %s even to the app renderer', (permission) => {
    expect(request(permission, 'hibiki://app/')).toBe(false)
    expect(spies.warn).toHaveBeenCalledWith('[permissions]', `Denied ${permission} to hibiki:`)
  })

  it.each([
    'hibiki://app.evil/',
    'hibiki://sound/music/x',
    'file:///home/gm/page.html',
    'not a url',
  ])('denies media to %s', (url) => {
    expect(request('media', url)).toBe(false)
    expect(spies.warn).toHaveBeenCalledTimes(1)
  })

  it('denies a request without a requesting URL', () => {
    const { requestHandler } = createPermissionPolicy()
    const callback = jest.fn()
    requestHandler({}, 'media', callback, undefined)
    expect(callback).toHaveBeenCalledWith(false)
  })

  it('never logs the path or query of the requesting page', () => {
    request('media', 'https://evil.example/cb?token=secret')
    expect(spies.warn.mock.calls.flat().join(' ')).not.toContain('secret')
  })
})

describe('permission check handler', () => {
  it('allows media and speaker-selection for the app origin', () => {
    const { checkHandler } = createPermissionPolicy()
    expect(checkHandler(null, 'media', 'hibiki://app')).toBe(true)
    expect(checkHandler(null, 'speaker-selection', 'hibiki://app/')).toBe(true)
    expect(spies.warn).not.toHaveBeenCalled()
  })

  it('denies everything else and logs each origin and permission once', () => {
    const { checkHandler } = createPermissionPolicy()
    expect(checkHandler(null, 'media', 'https://evil.example')).toBe(false)
    expect(checkHandler(null, 'media', 'https://evil.example')).toBe(false)
    expect(checkHandler(null, 'geolocation', 'https://evil.example')).toBe(false)
    expect(checkHandler(null, 'notifications', 'hibiki://app')).toBe(false)

    expect(spies.warn.mock.calls).toEqual([
      ['[permissions]', 'Denied the media check to https://evil.example'],
      ['[permissions]', 'Denied the geolocation check to https://evil.example'],
      ['[permissions]', 'Denied the notifications check to hibiki:'],
    ])
  })
})

describe('display media request handler', () => {
  it.each(['https://evil.example', 'hibiki://app'])('refuses screen capture to %s and logs it', (securityOrigin) => {
    const { displayMediaHandler } = createPermissionPolicy()
    const callback = jest.fn()
    displayMediaHandler({ securityOrigin, audioRequested: true }, callback)
    expect(callback).toHaveBeenCalledWith({})
    expect(spies.warn).toHaveBeenCalledWith('[permissions]', expect.stringContaining('Refused screen capture'))
  })
})

describe('installPermissionPolicy', () => {
  it('installs all three handlers on the session and logs it', () => {
    const session = {
      setPermissionRequestHandler: jest.fn(),
      setPermissionCheckHandler: jest.fn(),
      setDisplayMediaRequestHandler: jest.fn(),
    }
    installPermissionPolicy(session)
    expect(session.setPermissionRequestHandler).toHaveBeenCalledWith(expect.any(Function))
    expect(session.setPermissionCheckHandler).toHaveBeenCalledWith(expect.any(Function))
    expect(session.setDisplayMediaRequestHandler).toHaveBeenCalledWith(expect.any(Function))
    expect(spies.info).toHaveBeenCalledWith('[permissions]', expect.stringContaining('media and speaker-selection'))
  })
})
