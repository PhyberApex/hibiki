import { buildAppMenuTemplate, devToolsAllowed, installDevToolsPolicy } from './devtools'

const info = jest.spyOn(console, 'info').mockImplementation(() => {})
const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

afterEach(() => jest.clearAllMocks())
afterAll(() => jest.restoreAllMocks())

function fakeMenu() {
  return {
    buildFromTemplate: jest.fn((template: unknown) => ({ template })),
    setApplicationMenu: jest.fn(),
  }
}

/** Every `role` in a menu template, submenus included. */
function roles(template: any[]): string[] {
  return template.flatMap(item => [
    ...(item.role
      ? [item.role]
      : []),
    ...(Array.isArray(item.submenu)
      ? roles(item.submenu)
      : []),
  ])
}

describe('devToolsAllowed (#785)', () => {
  it('allows developer tools in an unpackaged build', () => {
    expect(devToolsAllowed({ packaged: false, env: {} })).toBe(true)
  })

  it('refuses them in a packaged build', () => {
    expect(devToolsAllowed({ packaged: true, env: {} })).toBe(false)
    expect(devToolsAllowed({
      packaged: true,
      env: { HIBIKI_DEVTOOLS: 'true' },
    })).toBe(false)
  })

  it('allows them in a packaged build only with HIBIKI_DEVTOOLS=1', () => {
    expect(devToolsAllowed({
      packaged: true,
      env: { HIBIKI_DEVTOOLS: '1' },
    })).toBe(true)
  })
})

describe('buildAppMenuTemplate (#785)', () => {
  it.each(['win32', 'linux', 'darwin'])('has no developer tools entry on %s', (platform) => {
    const template = buildAppMenuTemplate({ platform })
    expect(roles(template)).not.toContain('toggleDevTools')
    expect(roles(template)).toEqual(expect.arrayContaining([
      'editMenu',
      'reload',
      'togglefullscreen',
      'windowMenu',
    ]))
  })

  it('keeps the app menu, with Quit, only on macOS', () => {
    expect(roles(buildAppMenuTemplate({ platform: 'darwin' }))).toContain('appMenu')
    expect(roles(buildAppMenuTemplate({ platform: 'win32' }))).not.toContain('appMenu')
  })
})

describe('installDevToolsPolicy (#785)', () => {
  it('replaces the default menu and reports developer tools off in a packaged build', () => {
    const Menu = fakeMenu()
    expect(installDevToolsPolicy({
      Menu,
      packaged: true,
      env: {},
      platform: 'win32',
    })).toBe(false)
    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1)
    const [[menu]] = Menu.setApplicationMenu.mock.calls
    expect(roles((menu as { template: any[] }).template)).not.toContain('toggleDevTools')
    expect(info).toHaveBeenCalledWith('[app]', expect.stringContaining('Developer tools disabled'))
  })

  it('keeps the default menu and warns when HIBIKI_DEVTOOLS=1 opens them in a packaged build', () => {
    const Menu = fakeMenu()
    expect(installDevToolsPolicy({
      Menu,
      packaged: true,
      env: { HIBIKI_DEVTOOLS: '1' },
      platform: 'linux',
    })).toBe(true)
    expect(Menu.setApplicationMenu).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('[app]', expect.stringContaining('HIBIKI_DEVTOOLS=1'))
  })

  it('keeps the default menu in an unpackaged build', () => {
    const Menu = fakeMenu()
    expect(installDevToolsPolicy({
      Menu,
      packaged: false,
      env: {},
      platform: 'linux',
    })).toBe(true)
    expect(Menu.setApplicationMenu).not.toHaveBeenCalled()
  })
})
