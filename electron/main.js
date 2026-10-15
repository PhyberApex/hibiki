const fs = require('node:fs')
const path = require('node:path')
const { PassThrough, Readable } = require('node:stream')
const { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, protocol, safeStorage, session, shell, WebContentsView } = require('electron')
const { createHotkeys, affectsHotkeys } = require('./hotkeys')
const { createLogger, setupFileLogging } = require('./logger')

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
  { scheme: 'hibiki', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

if (process.env.HIBIKI_USER_DATA_DIR) {
  app.setPath('userData', process.env.HIBIKI_USER_DATA_DIR)
  app.setPath('sessionData', process.env.HIBIKI_USER_DATA_DIR)
}

const logging = setupFileLogging(
  path.join(app.getPath('userData'), 'logs'),
  `Hibiki ${app.getVersion()} starting (electron ${process.versions.electron}, node ${process.versions.node}, ${process.platform} ${process.arch})`,
)

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in the main process:', err)
  dialog.showErrorBox('Hibiki ran into an unexpected error', `${err?.stack || err}\n\nDetails were written to the log file (Settings → Diagnostics).`)
})

const ipcLog = createLogger('ipc')
const windowLog = createLogger('window')
const browserLog = createLogger('browser')
const protocolLog = createLogger('protocol')
const rendererLog = createLogger('renderer')
const appLog = createLogger('app')

let appHandle = null
let mainWindow = null
let hotkeys = null

/**
 * On Linux without a keyring, `safeStorage` reports encryption as available
 * but silently falls back to a `basic_text` backend that doesn't actually
 * encrypt — so that backend is treated as unavailable too (see issue #412).
 */
function isSecretEncryptionAvailable() {
  if (!safeStorage.isEncryptionAvailable())
    return false
  if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function')
    return safeStorage.getSelectedStorageBackend() !== 'basic_text'
  return true
}

function createSecretCodec() {
  return {
    available: isSecretEncryptionAvailable(),
    encrypt: plaintext => safeStorage.encryptString(plaintext).toString('base64'),
    decrypt: ciphertext => safeStorage.decryptString(Buffer.from(ciphertext, 'base64')),
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
  win.loadURL(loadUrl)
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 'warning')
      rendererLog[details.level === 'error' ? 'error' : 'warn'](`${details.message} (${details.sourceId}:${details.lineNumber})`)
    else if (details.level === 'info' && details.message.startsWith('['))
      rendererLog.info(details.message)
  })
  win.webContents.on('render-process-gone', (_, details) => {
    windowLog.error(`Renderer process gone: ${details.reason} (exit code ${details.exitCode})`)
  })
  win.webContents.on('unresponsive', () => windowLog.warn('Renderer became unresponsive'))
  win.webContents.on('responsive', () => windowLog.info('Renderer responsive again'))
  win.on('closed', () => {
    windowLog.info('Main window closed')
    mainWindow = null
  })
  windowLog.info('Main window created')
  mainWindow = win
  return win
}

/** audioStreams: Map<guildId, Map<streamId|undefined, PassThrough>> - multiple music streams per guild, mixed by backend */
const audioStreams = new Map()
/** effectStreams: Map<guildId, Map<streamId, PassThrough>> - multiple streams per guild, mixed by backend */
const effectStreams = new Map()

function getOrCreateAudioStreams(guildId) {
  if (!audioStreams.has(guildId))
    audioStreams.set(guildId, new Map())
  return audioStreams.get(guildId)
}

function getOrCreateEffectStreams(guildId) {
  if (!effectStreams.has(guildId))
    effectStreams.set(guildId, new Map())
  return effectStreams.get(guildId)
}

/**
 * The Local Target's sink (ADR-0004): the backend mix goes to the renderer as
 * `audio:localSinkStart` / `audio:localSinkChunk` / `audio:localSinkStop`, the
 * main -> renderer mirror of the `audio:*` chunk pattern. The renderer reports
 * health back through the `player.reportLocalSinkHealth` API call.
 */
function createLocalSink() {
  const send = (channel, ...args) => {
    if (!mainWindow || mainWindow.isDestroyed())
      throw new Error('No renderer to play local audio in')
    mainWindow.webContents.send(channel, ...args)
  }
  return {
    start: () => {
      ipcLog.info('audio:localSinkStart')
      send('audio:localSinkStart')
    },
    // Copy: a Buffer from the mixer may be a slice of a larger pooled ArrayBuffer, which IPC would clone whole.
    write: packet => send('audio:localSinkChunk', Uint8Array.from(packet)),
    stop: () => {
      ipcLog.info('audio:localSinkStop')
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('audio:localSinkStop')
    },
  }
}

function registerIpcHandlers(api) {
  ipcMain.handle('api', async (_, { domain, method, args }) => {
    const obj = api[domain]
    if (!obj || typeof obj[method] !== 'function') {
      ipcLog.error(`Unknown API: ${domain}.${method}`)
      throw new Error(`Unknown API: ${domain}.${method}`)
    }
    try {
      const result = await obj[method](...args)
      if (hotkeys && affectsHotkeys(domain, method))
        await hotkeys.sync()
      return result
    }
    catch (err) {
      ipcLog.error(`${domain}.${method} failed:`, err)
      throw err
    }
  })

  ipcMain.handle('audio:startStream', async (_, { guildId, metadata, streamId }) => {
    const streams = getOrCreateAudioStreams(guildId)
    if (streams.has(streamId)) {
      streams.get(streamId).end()
      streams.delete(streamId)
    }
    const stream = new PassThrough()
    streams.set(streamId, stream)
    ipcLog.info(`audio:startStream ${streamId} for guild ${guildId}`)
    api.player.startStream(guildId, stream, metadata, streamId)
  })

  ipcMain.on('audio:chunk', (_, { guildId, streamId, chunk }) => {
    const streams = audioStreams.get(guildId)
    if (!streams)
      return
    const stream = streams.get(streamId)
    if (stream && chunk && chunk.byteLength > 0)
      stream.push(Buffer.from(chunk))
  })

  ipcMain.handle('audio:stopStream', async (_, { guildId, streamId }) => {
    const streams = audioStreams.get(guildId)
    if (streams) {
      const stream = streams.get(streamId)
      if (stream) {
        streams.delete(streamId)
        stream.end()
      }
    }
    ipcLog.info(`audio:stopStream ${streamId} for guild ${guildId}`)
    api.player.stopStream(guildId, streamId)
  })

  ipcMain.handle('audio:startEffectStream', async (_, { guildId, streamId }) => {
    const id = streamId || `stream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const streams = getOrCreateEffectStreams(guildId)
    if (streams.has(id)) {
      streams.get(id).end()
      streams.delete(id)
    }
    const stream = new PassThrough()
    streams.set(id, stream)
    ipcLog.info(`audio:startEffectStream ${id} for guild ${guildId}`)
    api.player.startEffectStream(guildId, stream)
    return id
  })

  ipcMain.on('audio:effectChunk', (_, { guildId, streamId, chunk }) => {
    const streams = effectStreams.get(guildId)
    if (!streams)
      return
    const stream = streamId ? streams.get(streamId) : streams.values().next().value
    if (stream && chunk && chunk.byteLength > 0)
      stream.push(Buffer.from(chunk))
  })

  ipcMain.handle('audio:stopEffectStream', async (_, { guildId, streamId }) => {
    const streams = effectStreams.get(guildId)
    if (!streams)
      return
    ipcLog.info(`audio:stopEffectStream ${streamId ?? '(all)'} for guild ${guildId}`)
    if (streamId) {
      const stream = streams.get(streamId)
      if (stream) {
        streams.delete(streamId)
        stream.end()
      }
    }
    else {
      streams.forEach(s => s.end())
      streams.clear()
    }
  })
}

const browserViews = new Map()

function registerBrowserViewHandlers() {
  ipcMain.handle('browserView:create', async (_, { url }) => {
    if (!mainWindow)
      throw new Error('No main window')
    const view = new WebContentsView()
    mainWindow.contentView.addChildView(view)
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    const id = view.webContents.id

    view.webContents.on('did-start-navigation', (_, navUrl, __, isMainFrame) => {
      if (isMainFrame && mainWindow)
        mainWindow.webContents.send('browserView:didNavigate', id, navUrl)
    })
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
    browserViews.delete(id)
    if (mainWindow)
      mainWindow.contentView.removeChildView(view)
    view.webContents.close({ waitForBeforeUnload: false })
  })

  ipcMain.handle('browserView:setBounds', async (_, { id, bounds }) => {
    const view = browserViews.get(id)
    if (view)
      view.setBounds(bounds)
  })

  ipcMain.handle('browserView:loadURL', async (_, { id, url }) => {
    const view = browserViews.get(id)
    if (view)
      view.webContents.loadURL(url).catch(() => {})
  })

  ipcMain.handle('browserView:goBack', async (_, { id }) => {
    const view = browserViews.get(id)
    if (view?.webContents.navigationHistory.canGoBack())
      view.webContents.navigationHistory.goBack()
  })

  ipcMain.handle('browserView:goForward', async (_, { id }) => {
    const view = browserViews.get(id)
    if (view?.webContents.navigationHistory.canGoForward())
      view.webContents.navigationHistory.goForward()
  })

  ipcMain.handle('browserView:reload', async (_, { id }) => {
    const view = browserViews.get(id)
    if (view)
      view.webContents.reload()
  })

  ipcMain.handle('browserView:getMediaSourceId', async (_, { id }) => {
    const view = browserViews.get(id)
    if (!view || !mainWindow)
      throw new Error('View or window not found')
    return view.webContents.getMediaSourceId(mainWindow.webContents)
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
  const mime = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac' }[ext] || 'application/octet-stream'

  const rangeHeader = request.headers.get('range')
  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
    if (match) {
      const start = Number.parseInt(match[1], 10)
      const end = match[2] ? Number.parseInt(match[2], 10) : totalSize - 1
      const chunkSize = end - start + 1
      protocolLog.debug(`${path.basename(filePath)} 206 bytes ${start}-${end}/${totalSize}`)
      return fileResponse(filePath, {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        },
      }, { start, end })
    }
  }

  protocolLog.debug(`${path.basename(filePath)} 200 full ${totalSize} bytes${rangeHeader ? ` (unparsed range "${rangeHeader}")` : ''}`)
  return fileResponse(filePath, {
    headers: {
      'Content-Type': mime,
      'Content-Length': String(totalSize),
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

function registerHibikiProtocol(api, webDistDir) {
  protocol.handle('hibiki', (request) => {
    const u = new URL(request.url)
    const host = u.hostname
    const pathname = u.pathname || '/'

    if (host === 'sound') {
      const parts = pathname.split('/').filter(Boolean)
      const [type, id] = parts
      if ((type === 'music' || type === 'effects' || type === 'ambience') && id) {
        return api.sounds.getFilePath(type, decodeURIComponent(id)).then((filePath) => {
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
    }

    if (host === 'app') {
      let filePath = pathname === '/' ? path.join(webDistDir, 'index.html') : path.join(webDistDir, pathname)
      // SPA fallback: serve index.html for routes that don't match a static file
      if (!fs.existsSync(filePath))
        filePath = path.join(webDistDir, 'index.html')
      const ext = path.extname(filePath).toLowerCase()
      const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }[ext] || 'application/octet-stream'
      return fileResponse(filePath, { headers: { 'Content-Type': mime } })
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
    const embedded = await getEmbeddedApp(createSecretCodec(), { localSink: createLocalSink() })
    handle = embedded
    api = embedded.api
  }
  catch (err) {
    console.error('Failed to start embedded app:', err)
    app.quit(1)
    return
  }
  appHandle = handle
  handle.onPlayerStateChanged(() => {
    if (mainWindow)
      mainWindow.webContents.send('player:stateChanged')
  })

  const webDistDir = path.join(botRoot, 'web-dist')
  if (!fs.existsSync(path.join(webDistDir, 'index.html'))) {
    console.error('web-dist/index.html not found. Run: pnpm run build')
    app.quit(1)
    return
  }

  registerIpcHandlers(api)
  hotkeys = createHotkeys({ globalShortcut, getApi: () => api, getWindow: () => mainWindow })
  ipcMain.handle('hotkeys:getStatus', () => hotkeys.getStatus())
  await hotkeys.sync()
  registerBrowserViewHandlers()
  registerHibikiProtocol(api, webDistDir)

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] })
      .then((sources) => {
        if (sources.length === 0) {
          callback({})
          return
        }
        const opts = { video: sources[0] }
        if (request.audioRequested)
          opts.audio = 'loopback'
        callback(opts)
      })
      .catch((err) => {
        console.error('Display media request failed:', err)
        callback({})
      })
  }, { useSystemPicker: true })

  ipcMain.handle('dialog:selectFolder', async (_, options = {}) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? null, {
      properties: ['openDirectory'],
      title: options.title ?? 'Select folder',
    })
    if (result.canceled || result.filePaths.length === 0)
      return null
    return result.filePaths[0]
  })

  ipcMain.handle('dialog:saveFile', async (_, options = {}) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showSaveDialog(win ?? null, {
      title: options.title ?? 'Save file',
      defaultPath: options.defaultPath,
      filters: options.filters,
    })
    if (result.canceled || !result.filePath)
      return null
    return result.filePath
  })

  ipcMain.handle('dialog:openFile', async (_, options = {}) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? null, {
      properties: ['openFile'],
      title: options.title ?? 'Open file',
      filters: options.filters,
    })
    if (result.canceled || result.filePaths.length === 0)
      return null
    return result.filePaths[0]
  })

  ipcMain.handle('logs:getPath', () => logging.logFile)
  ipcMain.handle('logs:openFolder', () => shell.openPath(logging.logsDir))

  ipcMain.handle('shell:openExternal', (_, url) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://')))
      return shell.openExternal(url)
  })

  createWindow('hibiki://app/')
}).catch((err) => {
  console.error('Electron app.whenReady failed:', err)
  app.quit(1)
})

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
    handle.close().catch(err => console.error('Error during shutdown teardown:', err)),
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
