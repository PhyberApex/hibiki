import fs from 'node:fs'
import path from 'node:path'

const ipcRenderer = {
  invoke: jest.fn(async () => 'result'),
  send: jest.fn(),
  on: jest.fn(),
  removeListener: jest.fn(),
}
let exposed: any
jest.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_key: string, api: unknown) => { exposed = api },
  },
  ipcRenderer,
  webUtils: {
    getPathForFile: () => '',
  },
}), { virtual: true })
// eslint-disable-next-line ts/no-require-imports
require('./preload')

const error = jest.spyOn(console, 'error').mockImplementation(() => {})

beforeEach(() => {
  jest.clearAllMocks()
})

/** Every non-spec source file under `dir`, recursively. */
function sources(dir: string, ext: RegExp): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory())
      return sources(full, ext)
    return ext.test(entry.name) && !/\.(?:spec|test)\./.test(entry.name)
      ? [full]
      : []
  })
}

function matches(files: string[], pattern: RegExp): Set<string> {
  const found = new Set<string>()
  for (const file of files) {
    for (const m of fs.readFileSync(file, 'utf-8').matchAll(pattern))
      found.add(m[1])
  }
  return found
}

const mainFiles = sources(__dirname, /\.js$/).filter(f => !f.endsWith('preload.js'))
const rendererFiles = sources(path.join(__dirname, '..', 'frontend', 'src'), /\.(?:ts|vue)$/)

/** The channels main serves or sends, read from its source. */
const main = {
  invoke: new Set([
    ...matches(mainFiles, /\b(?:ipc|trustedIpc)\.handle\('([^']+)'/g),
    ...[
      ...matches(mainFiles, /handleFileDialog\('(\w+)'/g),
    ].map(kind => `dialog:${kind}`),
  ]),
  send: matches(mainFiles, /\b(?:ipc|trustedIpc)\.on\('([^']+)'/g),
  receive: matches(mainFiles, /send\('(\w+:\w+)'/g),
}

const channel = (re: string) => new RegExp(re, 'g')

/** The channels the renderer uses, read from its source. */
const renderer = {
  invoke: matches(rendererFiles, channel(`\\.invoke\\('([^']+)'`)),
  send: matches(rendererFiles, channel(`\\.send\\('([^']+)'`)),
  receive: new Set([
    ...matches(rendererFiles, channel(`hibiki\\.on\\('([^']+)'`)),
    ...matches(rendererFiles, channel(`onBrowserViewEvent\\('([^']+)'`)),
  ]),
}

function allowed(method: 'invoke' | 'send' | 'on', name: string): boolean {
  try {
    const result = exposed[method](name, ...(method === 'on'
      ? [
          () => {},
        ]
      : []))
    if (result instanceof Promise)
      result.catch(() => {})
  }
  catch {
    return false
  }
  return (ipcRenderer as any)[method].mock.calls.some((call: unknown[]) => call[0] === name)
}

describe('preload channel allowlist', () => {
  it('found the channels it checks in main and the renderer', () => {
    expect(main.invoke.size).toBeGreaterThan(20)
    expect(main.send).toEqual(new Set(['audio:chunk', 'audio:effectChunk']))
    expect(main.receive.size).toBeGreaterThan(5)
    expect(renderer.invoke.size).toBeGreaterThan(20)
  })

  it.each([...main.invoke])('lets the renderer invoke %s, which main handles', (name) => {
    expect(allowed('invoke', name)).toBe(true)
  })

  it.each([...main.send])('lets the renderer send %s, which main listens for', (name) => {
    expect(allowed('send', name)).toBe(true)
  })

  it.each([...main.receive])('lets the renderer listen for %s, which main sends', (name) => {
    expect(allowed('on', name)).toBe(true)
  })

  it('allows nothing the renderer uses that main does not serve', () => {
    for (const name of renderer.invoke)
      expect(main.invoke).toContain(name)
    for (const name of renderer.send)
      expect(main.send).toContain(name)
    for (const name of renderer.receive)
      expect(main.receive).toContain(name)
  })

  it('rejects an invoke on any other channel without reaching main, and logs it', async () => {
    await expect(exposed.invoke('evil:channel', {})).rejects.toThrow('Unknown IPC channel: evil:channel')
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[preload] Refused invoke on unknown channel evil:channel'))
  })

  it('refuses send and on for channels outside their own list', () => {
    expect(() => exposed.send('api', {})).toThrow('Unknown IPC channel: api')
    expect(() => exposed.on('api', () => {})).toThrow('Unknown IPC channel: api')
    expect(() => exposed.on('audio:chunk', () => {})).toThrow()
    expect(ipcRenderer.send).not.toHaveBeenCalled()
    expect(ipcRenderer.on).not.toHaveBeenCalled()
  })

  it('refuses invoke on a receive-only channel and on non-string names', async () => {
    await expect(exposed.invoke('player:stateChanged')).rejects.toThrow()
    await expect(exposed.invoke({
      toString: () => 'api',
    })).rejects.toThrow()
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('passes arguments through and unsubscribes the listener it added', async () => {
    await expect(exposed.invoke('api', { domain: 'scenes', method: 'list', args: [] })).resolves.toBe('result')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('api', { domain: 'scenes', method: 'list', args: [] })

    const callback = jest.fn()
    const off = exposed.on('hotkey:fired', callback)
    const listener = (ipcRenderer.on.mock.calls[0] as unknown[])[1] as (...a: unknown[]) => void
    listener({ sender: 'event' }, { accelerator: 'F1' })
    expect(callback).toHaveBeenCalledWith({ accelerator: 'F1' })
    off()
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('hotkey:fired', listener)
  })
})
