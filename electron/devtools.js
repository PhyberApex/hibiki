const { createLogger } = require('./logger')

const log = createLogger('app')

/** Set to `1` in the environment to get developer tools back in a packaged build, for diagnostics. */
const DEVTOOLS_ENV = 'HIBIKI_DEVTOOLS'

/**
 * Whether windows may open developer tools (#785). The preload bridge reaches
 * every backend capability, `config.setDiscordToken` included, so in a
 * packaged build a "paste this into the console" request would hand over the
 * whole app. Unpackaged builds keep them; a packaged one only with `HIBIKI_DEVTOOLS=1`.
 */
function devToolsAllowed({ packaged, env }) {
  return !packaged || env[DEVTOOLS_ENV] === '1'
}

/**
 * Electron's default menu minus `toggleDevTools` and its F12 / Ctrl+Shift+I
 * accelerators. macOS keeps the app menu, which carries Quit and Hide.
 */
function buildAppMenuTemplate({ platform }) {
  const view = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  }
  return [
    ...(platform === 'darwin'
      ? [
          { role: 'appMenu' },
        ]
      : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    view,
    { role: 'windowMenu' },
  ]
}

/**
 * Decides once, at startup, whether developer tools are available, and swaps
 * in the menu without them when they are not. The returned flag goes into
 * every window's and Browser tab's `webPreferences.devTools`, which is what
 * actually refuses `openDevTools()`; the menu only removes the way in.
 */
function installDevToolsPolicy({ Menu, packaged, env, platform }) {
  const allowed = devToolsAllowed({ packaged, env })
  if (!allowed) {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildAppMenuTemplate({ platform })))
    log.info(`Developer tools disabled (packaged build; set ${DEVTOOLS_ENV}=1 to enable them)`)
  }
  else if (packaged) {
    log.warn(`Developer tools enabled in a packaged build by ${DEVTOOLS_ENV}=1`)
  }
  else {
    log.info('Developer tools enabled (unpackaged build)')
  }
  return allowed
}

module.exports = {
  buildAppMenuTemplate,
  DEVTOOLS_ENV,
  devToolsAllowed,
  installDevToolsPolicy,
}
