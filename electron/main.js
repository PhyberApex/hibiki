const fs = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')
const { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, protocol, safeStorage, session, shell, WebContentsView } = require('electron')
const { createHotkeys } = require('./hotkeys')
const { createLocalSink, registerApiHandler, registerAudioStreamHandlers } = require('./ipc-streams')
const { createUncaughtExceptionHandler, exitWithError } = require('./lifecycle')
const { createLogger, setupFileLogging } = require('./logger')
const { describeScheme, describeUrl, forwardMainFrameNavigation, guardMainWindowNavigation, isWebUrl } = require('./navigation-guard')
const { parseRange, resolveAppPath } = require('./protocol')
const { parseSoundPath, SOUND_ALLOWED_ORIGIN } = require('./sound-url')

// Squirrel.Windows relaunches the installed app with lifecycle flags during
// install/update/uninstall. Quitting here means `app.whenReady()` below never
// resolves, so the window, backend boot and Discord login never happen.
if (require('electron-squirrel-startup')) {
  app.quit()
}

protocol.registerSchemesAsPrivileged([
  // `corsEnabled` lets audio elements with `crossOrigin = 'anonymous'` (needed
  // to capture them into Web Audio for Discord streaming) load hibiki://sound
  // URLs; without it Chromium rejects the request before it reaches the
  // handler. `stream` marks media responses as streamable.
  {
    scheme: 'hibiki',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

if (process.env.HIBIKI_USER_DATA_DIR) {
  app.setPath('userData', process.env.HIBIKI_USER_DATA_DIR)
  app.setPath('sessionData', process.env.HIBIKI_USER_DATA_DIR)
}

const logging = setupFileLogging(
  path.join(app.getPath('userData'), 'logs'),
  `Hibiki ${app.getVersion()} starting (electron ${process.versions.electron}, node ${process.versions.node}, ${process.platform} ${process.arch})`,
)

const windowLog = createLogger('window')
const browserLog = createLogger('browser')
const protocolLog = createLogger('protocol')
const rendererLog = createLogger('renderer')
const appLog = createLogger('app')
const dialogLog = createLogger('dialog')
const captureLog = createLogger('capture')

let appHandle = null
let mainWindow = null
let hotkeys = null
/** `registerAudioStreamHandlers`' handle; `endAll` tears down the renderer's chunked-IPC streams when it goes away. */
let audioStreamHandlers = null

process.on('uncaughtException', createUncaughtExceptionHandler({
  dialog,
  isReady: () => app.isReady(),
  getWindow: () => mainWindow,
}))

/** Startup cannot continue: release what already started and exit with code 1. */
function exitAfterFatalError(message, err) {
  return exitWithError({
    app,
    teardown: async () => {
      hotkeys?.releaseAll()
      await teardownBeforeQuit()
    },
  }, message, err)
}

/**
 * On Linux without a keyring, `safeStorage` reports encryption as available
 * but silently falls back to a `basic_text` backend that doesn't actually
 * encrypt — so that backend is treated as unavailable too (see issue #412).
 * Must run after `app.whenReady()`: the async encryptor initialises lazily
 * on the first call, and the Linux backend is `unknown` before then.
 */
async function isSecretEncryptionAvailable() {
  try {
    if (!await safeStorage.isAsyncEncryptionAvailable())
      return false
  }
  catch (err) {
    appLog.warn('Could not initialise safeStorage encryption; storing secrets unencrypted', err)
    return false
  }
  if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function')
    return safeStorage.getSelectedStorageBackend() !== 'basic_text'
  return true
}

/** Uses only the async `safeStorage` methods; the sync ones are deprecated in Electron 45 and removed in 46. */
async function createSecretCodec() {
  return {
    available: await isSecretEncryptionAvailable(),
    encrypt: async plaintext => (await safeStorage.encryptStringAsync(plaintext)).toString('base64'),
    decrypt: ciphertext => safeStorage.decryptStringAsync(Buffer.from(ciphertext, 'base64')),
  }
}

function createWindow(loadUrl) {
  const isTestMode = process.env.ELECTRON_TEST_MODE === '1'
  const win = new BrowserWindow({
    width: 1400,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    show: !isTestMode,
    webPreferences: {
      // The Local sink starts playing on backend demand, not on a click.
      autoplayPolicy: 'no-user-gesture-required',
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  guardMainWindowNavigation(win.webContents, {
    appUrl: loadUrl,
    openExternal: url => shell.openExternal(url),
  })
  win.loadURL(loadUrl)
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 'warning') {
      rendererLog[details.level === 'error'
        ? 'error'
        : 'warn'](`${details.message} (${details.sourceId}:${details.lineNumber})`)
    }
    else if (details.level === 'info' && details.message.startsWith('[')) {
      rendererLog.info(details.message)
    }
    else if (details.level === 'debug' && details.message.startsWith('[')) {
      rendererLog.debug(details.message)
    }
  })
  win.webContents.on('render-process-gone', (_, details) => {
    windowLog.error(`Renderer process gone: ${details.reason} (exit code ${details.exitCode})`)
    releaseRendererResources(win, `renderer gone (${details.reason})`)
  })
  // A reload or crash recovery starts a fresh renderer that knows nothing of the old one's streams and Browser tabs.
  // `isSameDocument` excludes the router's pushState navigations; the initial load has nothing to release.
  win.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument)
      releaseRendererResources(win, 'renderer navigated')
  })
  win.webContents.on('unresponsive', () => windowLog.warn('Renderer became unresponsive'))
  win.webContents.on('responsive', () => windowLog.info('Renderer responsive again'))
  win.on('closed', () => {
    windowLog.info('Main window closed')
    releaseRendererResources(win, 'main window closed')
    mainWindow = null
  })
  windowLog.info('Main window created')
  mainWindow = win
  return win
}

function registerIpcHandlers(api) {
  registerApiHandler(ipcMain, api, () => hotkeys)
  audioStreamHandlers = registerAudioStreamHandlers(ipcMain, api.player)
}

const browserViews = new Map()

/** Closes one Browser tab: detaches it from `win` (when that window still exists) and closes its page. */
function destroyBrowserView(id, view, win) {
  browserViews.delete(id)
  if (win && !win.isDestroyed())
    win.contentView.removeChildView(view)
  if (!view.webContents.isDestroyed())
    view.webContents.close({ waitForBeforeUnload: false })
}

/** Closes every Browser tab; the renderer that opened them is gone, and with it the only way to close them. */
function destroyAllBrowserViews(win, reason) {
  if (browserViews.size === 0)
    return
  browserLog.info(`Closing ${browserViews.size} tab(s): ${reason}`)
  for (const [id, view] of browserViews) {
    browserLog.info(`Tab ${id} closed: ${reason}`)
    destroyBrowserView(id, view, win)
  }
}

/** Ends whatever the main window's renderer left behind in main: its chunked-IPC audio streams and its Browser tabs. */
function releaseRendererResources(win, reason) {
  audioStreamHandlers?.endAll(reason)
  destroyAllBrowserViews(win, reason)
}

function registerBrowserViewHandlers() {
  ipcMain.handle('browserView:create', async (_, { url }) => {
    if (!mainWindow)
      throw new Error('No main window')
    const view = new WebContentsView()
    mainWindow.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    const id = view.webContents.id

    view.webContents.on('did-start-navigation', forwardMainFrameNavigation((navUrl) => {
      if (mainWindow)
        mainWindow.webContents.send('browserView:didNavigate', id, navUrl)
    }))
    view.webContents.on('page-title-updated', (_, title) => {
      if (mainWindow)
        mainWindow.webContents.send('browserView:titleUpdated', id, title)
    })
    view.webContents.on('did-finish-load', () => {
      if (mainWindow)
        mainWindow.webContents.send('browserView:titleUpdated', id, view.webContents.getTitle())
    })
    view.webContents.on('page-favicon-updated', (_, favicons) => {
      if (mainWindow) {
        const faviconUrl = Array.isArray(favicons) && favicons.length > 0
          ? favicons[0]
          : null
        mainWindow.webContents.send('browserView:faviconUpdated', id, faviconUrl)
      }
    })
    view.webContents.on('media-started-playing', () => {
      if (mainWindow)
        mainWindow.webContents.send('browserView:mediaPlaying', id, true)
    })
    view.webContents.on('media-paused', () => {
      if (mainWindow)
        mainWindow.webContents.send('browserView:mediaPlaying', id, false)
    })
    view.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
      view.webContents.loadURL(linkUrl)
      return { action: 'deny' }
    })

    view.webContents.on('did-fail-load', (_, errorCode, errorDescription, failedUrl, isMainFrame) => {
      if (isMainFrame)
        browserLog.warn(`Tab ${id} failed to load ${failedUrl}: ${errorDescription} (${errorCode})`)
    })
    view.webContents.on('render-process-gone', (_, details) => {
      browserLog.error(`Tab ${id} renderer gone: ${details.reason}`)
    })
    browserViews.set(id, view)

    browserLog.info(`Tab ${id} opened at ${url}`)
    view.webContents.loadURL(url).catch(() => {})

    return id
  })

  ipcMain.handle('browserView:destroy', async (_, { id }) => {
    const view = browserViews.get(id)
    if (!view)
      return
    browserLog.info(`Tab ${id} closed`)
    destroyBrowserView(id, view, mainWindow)
  })

  /**
   * The tab `id` names, or `undefined` after logging that `action` had nothing to act on.
   * `setBounds` follows every resize and can trail a closed tab, so it logs at `debug`.
   */
  const knownView = (id, action, level = 'warn') => {
    const view = browserViews.get(id)
    if (!view)
      browserLog[level](`${action} ignored: no tab ${id}`)
    return view
  }

  ipcMain.handle('browserView:setBounds', async (_, { id, bounds }) => {
    knownView(id, 'setBounds', 'debug')?.setBounds(bounds)
  })

  ipcMain.handle('browserView:loadURL', async (_, { id, url }) => {
    const view = knownView(id, 'loadURL')
    if (view) {
      browserLog.info(`Tab ${id} loading ${describeUrl(url)}`)
      view.webContents.loadURL(url).catch(() => {})
    }
  })

  ipcMain.handle('browserView:goBack', async (_, { id }) => {
    const view = knownView(id, 'goBack')
    if (view?.webContents.navigationHistory.canGoBack())
      view.webContents.navigationHistory.goBack()
  })

  ipcMain.handle('browserView:goForward', async (_, { id }) => {
    const view = knownView(id, 'goForward')
    if (view?.webContents.navigationHistory.canGoForward())
      view.webContents.navigationHistory.goForward()
  })

  ipcMain.handle('browserView:reload', async (_, { id }) => {
    knownView(id, 'reload')?.webContents.reload()
  })

  ipcMain.handle('browserView:getMediaSourceId', async (_, { id }) => {
    const view = browserViews.get(id)
    if (!view || !mainWindow)
      throw new Error('View or window not found')
    return view.webContents.getMediaSourceId(mainWindow.webContents)
  })

  ipcMain.handle('browserView:setAudioMuted', async (_, { id, muted }) => {
    const view = browserViews.get(id)
    if (!view)
      throw new Error(`Tab ${id} not found`)
    view.webContents.setAudioMuted(muted)
    browserLog.debug(`Tab ${id} ${muted ? 'muted' : 'unmuted'}`)
  })

  ipcMain.handle('browserView:show', async (_, { id }) => {
    const view = browserViews.get(id)
    if (view && mainWindow) {
      mainWindow.contentView.removeChildView(view)
      mainWindow.contentView.addChildView(view)
    }
  })

  ipcMain.handle('browserView:hide', async (_, { id }) => {
    const view = browserViews.get(id)
    if (view && mainWindow)
      mainWindow.contentView.removeChildView(view)
  })
}

/**
 * A `Response` whose body streams `filePath` from disk. The file stream is
 * converted with `Readable.toWeb` rather than handed to `Response` directly:
 * undici's own Node-stream adapter closes its controller from a microtask
 * without checking whether Chromium cancelled the request in the meantime,
 * which surfaces as an uncaught "ReadableStream is already closed" error in
 * the main process whenever an audio element stops or seeks near the end of
 * a file. Node's adapter tolerates that cancellation.
 */
function fileResponse(filePath, init, readOptions) {
  return new Response(Readable.toWeb(fs.createReadStream(filePath, readOptions)), init)
}

function serveSoundFile(request, filePath) {
  const stats = fs.statSync(filePath)
  const totalSize = stats.size
  const ext = path.extname(filePath).toLowerCase()
  const mime = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
  }[ext] || 'application/octet-stream'

  const rangeHeader = request.headers.get('range')
  const range = parseRange(rangeHeader, totalSize)
  if (range.kind === 'unsatisfiable') {
    protocolLog.debug(`${path.basename(filePath)} 416 range "${rangeHeader}" outside ${totalSize} bytes`)
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Range': `bytes */${totalSize}`,
        'Access-Control-Allow-Origin': SOUND_ALLOWED_ORIGIN,
      },
    })
  }
  if (range.kind === 'partial') {
    const { start, end } = range
    protocolLog.debug(`${path.basename(filePath)} 206 bytes ${start}-${end}/${totalSize}`)
    return fileResponse(filePath, {
      status: 206,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': SOUND_ALLOWED_ORIGIN,
      },
    }, { start, end })
  }

  protocolLog.debug(`${path.basename(filePath)} 200 full ${totalSize} bytes${rangeHeader
    ? ` (unparsed range "${rangeHeader}")`
    : ''}`)
  return fileResponse(filePath, {
    headers: {
      'Content-Type': mime,
      'Content-Length': String(totalSize),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': SOUND_ALLOWED_ORIGIN,
    },
  })
}

function registerHibikiProtocol(api, webDistDir) {
  protocol.handle('hibiki', (request) => {
    const u = new URL(request.url)
    const host = u.hostname
    const pathname = u.pathname || '/'

    if (host === 'sound') {
      const sound = parseSoundPath(pathname)
      if (!sound.ok) {
        protocolLog.warn(`Rejected hibiki://sound${pathname}: ${sound.reason}`)
        return new Response('Not Found', { status: 404 })
      }
      const { type, id } = sound
      return api.sounds.getFilePath(type, id).then((filePath) => {
        if (!fs.existsSync(filePath)) {
          protocolLog.warn(`${type}/${id} resolved to a missing file: ${filePath}`)
          return new Response('Not Found', { status: 404 })
        }
        return serveSoundFile(request, filePath)
      }).catch((err) => {
        protocolLog.warn(`Could not serve ${type}/${id}:`, err)
        return new Response('Not Found', { status: 404 })
      })
    }

    if (host === 'app') {
      const resolved = resolveAppPath(webDistDir, pathname)
      if (!resolved.ok) {
        protocolLog.warn(`Rejected hibiki://app${pathname}: ${resolved.reason}`)
        return new Response('Not Found', { status: 404 })
      }
      const { filePath } = resolved
      const ext = path.extname(filePath).toLowerCase()
      const mime = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.ico': 'image/x-icon',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.woff2': 'font/woff2',
      }[ext] || 'application/octet-stream'
      return fileResponse(filePath, {
        headers: { 'Content-Type': mime },
      })
    }

    return new Response('Not Found', { status: 404 })
  })
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData')
  const botRoot = path.join(__dirname, '..')
  process.env.HIBIKI_USER_DATA = userDataPath

  const dataDir = path.join(userDataPath, 'data')
  await fs.promises.mkdir(dataDir, { recursive: true })
  const appConfigPath = path.join(dataDir, 'app-config.json')
  try {
    const raw = await fs.promises.readFile(appConfigPath, 'utf-8')
    const appConfig = JSON.parse(raw)
    if (appConfig && typeof appConfig['storage.path'] === 'string' && appConfig['storage.path'].trim()) {
      process.env.HIBIKI_STORAGE_PATH = appConfig['storage.path'].trim()
    }
  }
  catch {
    // First launch or corrupted config — fall through to defaults
  }

  const { getEmbeddedApp } = require(path.join(botRoot, 'dist', 'bootstrap-embedded.js'))
  let handle
  let api
  try {
    const embedded = await getEmbeddedApp(await createSecretCodec(), {
      localSink: createLocalSink(() => mainWindow),
      appVersion: app.getVersion(),
      usageStats: {
        gate: { packaged: app.isPackaged, killSwitch: process.env.HIBIKI_USAGE_STATS === 'off' },
        environment: {
          electronVersion: process.versions.electron,
          platform: process.platform,
          arch: process.arch,
          locale: app.getLocale(),
        },
      },
    })
    handle = embedded
    api = embedded.api
  }
  catch (err) {
    await exitAfterFatalError('Failed to start embedded app:', err)
    return
  }
  appHandle = handle
  handle.onPlayerStateChanged(() => {
    if (mainWindow)
      mainWindow.webContents.send('player:stateChanged')
  })

  const webDistDir = path.join(botRoot, 'web-dist')
  if (!fs.existsSync(path.join(webDistDir, 'index.html'))) {
    await exitAfterFatalError('web-dist/index.html not found. Run: pnpm run build')
    return
  }

  registerIpcHandlers(api)
  hotkeys = createHotkeys({
    globalShortcut,
    getApi: () => api,
    getWindow: () => mainWindow,
  })
  ipcMain.handle('hotkeys:getStatus', () => hotkeys.getStatus())
  await hotkeys.sync()
  registerBrowserViewHandlers()
  registerHibikiProtocol(api, webDistDir)

  // Where the OS offers a system picker, Electron shows it and never calls
  // this handler, so a log line from here means the fallback was taken.
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    captureLog.info(`Display media requested (audio: ${request.audioRequested ? 'yes' : 'no'}); system picker not used, choosing a source`)
    desktopCapturer.getSources({
      types: ['screen', 'window'],
    })
      .then((sources) => {
        if (sources.length === 0) {
          captureLog.warn('No screen or window sources to capture; denying the request')
          callback({})
          return
        }
        const opts = { video: sources[0] }
        if (request.audioRequested)
          opts.audio = 'loopback'
        captureLog.info(`Capturing ${sources[0].id}, first of ${sources.length} source(s)${opts.audio ? ' with loopback audio' : ''}`)
        callback(opts)
      })
      .catch((err) => {
        captureLog.error('Display media request failed:', err)
        callback({})
      })
  }, { useSystemPicker: true })
  captureLog.info('Display media handler registered; the OS system picker is preferred where available')

  /**
   * Registers a file dialog handler that logs the request and the GM's choice.
   * Only the chosen file or folder name is logged: the full path carries the OS user name.
   * `show(title, options)` opens the dialog and resolves to the chosen path, or `null` when cancelled.
   */
  const handleFileDialog = (kind, defaultTitle, show) => {
    ipcMain.handle(`dialog:${kind}`, async (_, options = {}) => {
      const title = options.title ?? defaultTitle
      dialogLog.info(`${kind} "${title}" opened`)
      const chosen = await show(BrowserWindow.getFocusedWindow() ?? null, title, options)
      if (chosen)
        dialogLog.info(`${kind} "${title}": chose ${path.basename(chosen)}`)
      else
        dialogLog.info(`${kind} "${title}": cancelled`)
      return chosen || null
    })
  }

  handleFileDialog('selectFolder', 'Select folder', async (win, title) => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title,
    })
    return result.canceled
      ? null
      : result.filePaths[0]
  })

  handleFileDialog('saveFile', 'Save file', async (win, title, options) => {
    const result = await dialog.showSaveDialog(win, {
      title,
      defaultPath: options.defaultPath,
      filters: options.filters,
    })
    return result.canceled
      ? null
      : result.filePath
  })

  handleFileDialog('openFile', 'Open file', async (win, title, options) => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      title,
      filters: options.filters,
    })
    return result.canceled
      ? null
      : result.filePaths[0]
  })

  ipcMain.handle('logs:getPath', () => logging.logFile)
  ipcMain.handle('logs:openFolder', () => shell.openPath(logging.logsDir))

  ipcMain.handle('shell:openExternal', (_, url) => {
    if (isWebUrl(url))
      return shell.openExternal(url)
    appLog.warn(`openExternal refused a non-web URL (${describeScheme(url)})`)
  })

  createWindow('hibiki://app/')
}).catch(err => exitAfterFatalError('Electron app.whenReady failed:', err))

const SHUTDOWN_TEARDOWN_TIMEOUT_MS = 5_000

/**
 * Tears down voice connections/audio engines before the process exits — see
 * issue #456. Nulls `appHandle` synchronously (before its first await) so
 * the `before-quit` listener below can tell, on its re-triggered second
 * pass, that teardown already started and let quit proceed instead of
 * preventing default again. Time-bounded so a hung teardown can't block
 * quitting forever.
 */
async function teardownBeforeQuit() {
  const handle = appHandle
  appHandle = null
  if (!handle?.close)
    return
  let timeout
  await Promise.race([
    handle.close().catch(err => appLog.error('Error during shutdown teardown:', err)),
    new Promise((resolve) => { timeout = setTimeout(resolve, SHUTDOWN_TEARDOWN_TIMEOUT_MS) }),
  ])
  clearTimeout(timeout)
}

app.on('window-all-closed', () => {
  app.quit()
})

app.on('will-quit', () => {
  hotkeys?.releaseAll()
})

app.on('before-quit', (event) => {
  if (appHandle === null)
    return
  appLog.info('Quit requested; tearing down')
  event.preventDefault()
  teardownBeforeQuit().then(() => app.quit())
})
