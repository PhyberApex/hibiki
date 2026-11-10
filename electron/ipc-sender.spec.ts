import { APP_ORIGIN, createTrustedIpc, isTrustedSender } from './ipc-sender'

type Listener = (event: unknown, ...args: unknown[]) => unknown

function frame(url: string, parent: unknown = null) {
  return { url, parent }
}

function event(senderFrame: unknown) {
  return { senderFrame }
}

function fakeIpcMain() {
  const handlers = new Map<string, Listener>()
  const listeners = new Map<string, Listener>()
  return {
    handle: (channel: string, fn: Listener) => handlers.set(channel, fn),
    on: (channel: string, fn: Listener) => listeners.set(channel, fn),
    invoke: (channel: string, e: unknown, ...args: unknown[]) => handlers.get(channel)!(e, ...args),
    send: (channel: string, e: unknown, ...args: unknown[]) => listeners.get(channel)!(e, ...args),
  }
}

const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

beforeEach(() => warn.mockClear())

describe('isTrustedSender', () => {
  it('trusts the app\'s own top-level frame on any route', () => {
    expect(APP_ORIGIN).toBe('hibiki://app')
    expect(isTrustedSender(event(frame('hibiki://app/')))).toBe(true)
    expect(isTrustedSender(event(frame('hibiki://app/scenes?x=1')))).toBe(true)
  })

  it('refuses a sub-frame, even one on the app origin', () => {
    const top = frame('hibiki://app/')
    expect(isTrustedSender(event(frame('hibiki://app/', top)))).toBe(false)
  })

  it('refuses every other origin', () => {
    for (const url of [
      'https://example.com/',
      'hibiki://sound/music/a.mp3',
      'file:///etc/passwd',
      'http://hibiki.app/',
      'not a url',
    ])
      expect(isTrustedSender(event(frame(url)))).toBe(false)
  })

  it('refuses an event whose frame is gone', () => {
    expect(isTrustedSender(event(null))).toBe(false)
    expect(isTrustedSender(event(undefined))).toBe(false)
    expect(isTrustedSender(undefined)).toBe(false)
  })
})

describe('createTrustedIpc', () => {
  it('hands a trusted invoke to the handler with its event and arguments', async () => {
    const ipcMain = fakeIpcMain()
    const handler = jest.fn(async (_e: unknown, payload: unknown) => payload)
    createTrustedIpc(ipcMain).handle('api', handler)
    const e = event(frame('hibiki://app/'))

    await expect(ipcMain.invoke('api', e, { domain: 'x' })).resolves.toEqual({ domain: 'x' })
    expect(handler).toHaveBeenCalledWith(e, { domain: 'x' })
  })

  it('rejects an untrusted invoke without reaching the handler, and logs its channel and origin only', async () => {
    const ipcMain = fakeIpcMain()
    const handler = jest.fn()
    createTrustedIpc(ipcMain).handle('api', handler)

    await expect(ipcMain.invoke('api', event(frame('https://evil.example/path?token=secret')), {}))
      .rejects
      .toThrow('Refused api: untrusted sender')
    expect(handler).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    const line = warn.mock.calls[0].join(' ')
    expect(line).toContain('api')
    expect(line).toContain('https://evil.example')
    expect(line).not.toContain('token=secret')
  })

  it('passes a trusted message to the listener', () => {
    const ipcMain = fakeIpcMain()
    const listener = jest.fn()
    createTrustedIpc(ipcMain).on('audio:chunk', listener)
    const e = event(frame('hibiki://app/'))

    ipcMain.send('audio:chunk', e, { chunk: 1 })
    expect(listener).toHaveBeenCalledWith(e, { chunk: 1 })
  })

  it('drops untrusted messages and warns once per channel and origin, not once per chunk', () => {
    const ipcMain = fakeIpcMain()
    const listener = jest.fn()
    createTrustedIpc(ipcMain).on('audio:chunk', listener)
    const untrusted = event(frame('https://evil.example/'))

    for (let i = 0; i < 5; i++)
      ipcMain.send('audio:chunk', untrusted, { chunk: i })
    expect(listener).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)

    ipcMain.send('audio:chunk', event(frame('https://other.example/')), {})
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('says when the refused sender was a sub-frame', async () => {
    const ipcMain = fakeIpcMain()
    createTrustedIpc(ipcMain).handle('api', jest.fn())

    await expect(ipcMain.invoke('api', event(frame('hibiki://app/', frame('hibiki://app/'))))).rejects.toThrow()
    expect(warn.mock.calls[0].join(' ')).toContain('sub-frame')
  })
})
