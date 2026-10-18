import path from 'node:path'

// hotkeys.js loads the compiled registrar from dist/, which a test run need not have built: serve the source instead.
jest.doMock(
  path.join(__dirname, '..', 'dist', 'hotkeys', 'hotkey-registrar.js'),
  () => jest.requireActual('../src/hotkeys/hotkey-registrar'),
  { virtual: true },
)
// eslint-disable-next-line ts/no-require-imports
const { createHotkeys, affectsHotkeys } = require('./hotkeys')

const settings = {
  enabled: true,
  stopHotkey: 'CmdOrCtrl+Shift+S',
}

function scene(id: string, hotkey?: string, effects: { soundId: string, hotkey?: string }[] = []) {
  return { id, name: `Scene ${id}`, hotkey, music: [], ambience: [], effects }
}

function fakeGlobalShortcut(refused: string[] = []) {
  const callbacks = new Map<string, () => void>()
  return {
    callbacks,
    register: jest.fn((accelerator: string, callback: () => void) => {
      if (refused.includes(accelerator))
        return false
      callbacks.set(accelerator, callback)
      return true
    }),
    unregister: jest.fn((accelerator: string) => callbacks.delete(accelerator)),
  }
}

function fakeApi(scenes: unknown[], hotkeySettings: unknown = settings) {
  return {
    scenes: { list: jest.fn().mockResolvedValue(scenes) },
    config: { getHotkeySettings: jest.fn().mockResolvedValue(hotkeySettings) },
  }
}

function fakeWindow() {
  return { isDestroyed: jest.fn(() => false), webContents: { send: jest.fn() } }
}

beforeAll(() => {
  for (const level of ['debug', 'info', 'warn', 'error'] as const)
    jest.spyOn(console, level).mockImplementation(() => {})
})
afterEach(() => jest.clearAllMocks())
afterAll(() => jest.restoreAllMocks())

describe('createHotkeys', () => {
  it('registers the wanted accelerators on the global shortcut', async () => {
    const globalShortcut = fakeGlobalShortcut()
    const hotkeys = createHotkeys({ globalShortcut, getApi: () => fakeApi([scene('a', 'F1', [{ soundId: 'boom', hotkey: 'F2' }])]), getWindow: () => null })

    await hotkeys.sync()

    expect(globalShortcut.register.mock.calls.map(c => c[0]).sort()).toEqual(['CmdOrCtrl+Shift+S', 'F1', 'F2'])
    expect(hotkeys.getStatus()).toEqual(expect.objectContaining({ enabled: true, failures: [] }))
  })

  it('applies only the diff on the next sync', async () => {
    const globalShortcut = fakeGlobalShortcut()
    let scenes = [scene('a', 'F1'), scene('b', 'F2')]
    const hotkeys = createHotkeys({ globalShortcut, getApi: () => fakeApi(scenes), getWindow: () => null })
    await hotkeys.sync()
    globalShortcut.register.mockClear()

    scenes = [scene('a', 'F1'), scene('b', 'F3')]
    await hotkeys.sync()

    expect(globalShortcut.unregister).toHaveBeenCalledWith('F2')
    expect(globalShortcut.unregister).not.toHaveBeenCalledWith('F1')
    expect(globalShortcut.register.mock.calls.map(c => c[0])).toEqual(['F3'])
  })

  it('reports a refused registration through getStatus', async () => {
    const globalShortcut = fakeGlobalShortcut(['F1'])
    const hotkeys = createHotkeys({ globalShortcut, getApi: () => fakeApi([scene('a', 'F1')]), getWindow: () => null })

    await hotkeys.sync()

    expect(hotkeys.getStatus().failures).toEqual([
      expect.objectContaining({ accelerator: 'F1', owner: 'Scene "Scene a"' }),
    ])
    expect(hotkeys.getStatus().registered).not.toContain('F1')
  })

  it('forwards a fired accelerator to the renderer', async () => {
    const globalShortcut = fakeGlobalShortcut()
    const win = fakeWindow()
    const hotkeys = createHotkeys({ globalShortcut, getApi: () => fakeApi([scene('a', 'F1')]), getWindow: () => win })
    await hotkeys.sync()

    globalShortcut.callbacks.get('F1')!()

    expect(win.webContents.send).toHaveBeenCalledWith('hotkey:fired', { accelerator: 'F1' })
  })

  it('warns instead of sending when the window is gone', async () => {
    const globalShortcut = fakeGlobalShortcut()
    const win = fakeWindow()
    win.isDestroyed.mockReturnValue(true)
    const hotkeys = createHotkeys({ globalShortcut, getApi: () => fakeApi([scene('a', 'F1')]), getWindow: () => win })
    await hotkeys.sync()

    globalShortcut.callbacks.get('F1')!()

    expect(win.webContents.send).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith('[hotkeys]', 'F1 fired but there is no window to handle it')
  })

  it('does nothing before the API is up', async () => {
    const globalShortcut = fakeGlobalShortcut()
    const hotkeys = createHotkeys({ globalShortcut, getApi: () => null, getWindow: () => null })

    await hotkeys.sync()

    expect(globalShortcut.register).not.toHaveBeenCalled()
  })

  it('logs a failed sync and keeps later syncs working', async () => {
    const globalShortcut = fakeGlobalShortcut()
    const broken = fakeApi([])
    const err = new Error('scenes.json unreadable')
    broken.scenes.list.mockRejectedValueOnce(err)
    broken.scenes.list.mockResolvedValue([scene('a', 'F1')])
    const hotkeys = createHotkeys({ globalShortcut, getApi: () => broken, getWindow: () => null })

    await hotkeys.sync()
    expect(console.error).toHaveBeenCalledWith('[hotkeys]', 'Could not sync global hotkeys:', err)
    await hotkeys.sync()

    expect(globalShortcut.register).toHaveBeenCalledWith('F1', expect.any(Function))
  })

  it('releases every registration on releaseAll', async () => {
    const globalShortcut = fakeGlobalShortcut()
    const hotkeys = createHotkeys({ globalShortcut, getApi: () => fakeApi([scene('a', 'F1')]), getWindow: () => null })
    await hotkeys.sync()

    hotkeys.releaseAll()

    expect(globalShortcut.unregister).toHaveBeenCalledWith('F1')
    expect(hotkeys.getStatus().registered).toEqual([])
  })
})

describe('affectsHotkeys', () => {
  it.each([
    ['scenes', 'save', true],
    ['registry', 'install', true],
    ['config', 'setHotkeySettings', true],
    ['config', 'setMasterVolume', false],
    ['player', 'playMusic', false],
  ])('%s.%s -> %s', (domain, method, expected) => {
    expect(affectsHotkeys(domain, method)).toBe(expected)
  })
})
