const fs = require('node:fs')
const path = require('node:path')
const { PassThrough } = require('node:stream')
const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, protocol, session, WebContentsView } = require('electron')

protocol.registerSchemesAsPrivileged([
  { scheme: 'hibiki', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

let appHandle = null
let mainWindow = null
let splashWindow = null

function createSplashWindow() {
  // Skip splash screen in test mode
  if (process.env.ELECTRON_TEST_MODE === '1') {
    return null
  }
  const splash = new BrowserWindow({
    width: 500,
    height: 400,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  splash.loadFile(path.join(__dirname, 'splash.html'))
  splash.center()
  splashWindow = splash
  return splash
}

function createWindow(loadUrl) {
  const isTestMode = process.env.ELECTRON_TEST_MODE === '1'
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  win.loadURL(loadUrl)
  win.once('ready-to-show', () => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close()
      splashWindow = null
    }
    // In test mode, keep window hidden (headless)
    if (!isTestMode) {
      win.show()
    }
  })
  win.on('closed', () => {
    mainWindow = null
  })
  mainWindow = win
  return win
}

const audioStreams = new Map()
/** effectStreams: Map<guildId, Map<streamId, PassThrough>> - multiple streams per guild, mixed by backend */
const effectStreams = new Map()

function getOrCreateEffectStreams(guildId) {
  if (!effectStreams.has(guildId))
    effectStreams.set(guildId, new Map())
  return effectStreams.get(guildId)
}

function registerIpcHandlers(api) {
  ipcMain.handle('api', (_, { domain, method, args }) => {
    const obj = api[domain]
    if (!obj || typeof obj[method] !== 'function')
      throw new Error(`Unknown API: ${domain}.${method}`)
    return obj[method](...args)
  })

  ipcMain.handle('audio:startStream', async (_, { guildId, metadata }) => {
    if (audioStreams.has(guildId)) {
      const existing = audioStreams.get(guildId)
      existing.end()
      audioStreams.delete(guildId)
    }
    const stream = new PassThrough()
    audioStreams.set(guildId, stream)
    api.player.startStream(guildId, stream, metadata)
  })

  ipcMain.on('audio:chunk', (_, { guildId, chunk }) => {
    const stream = audioStreams.get(guildId)
    if (stream && chunk && chunk.byteLength > 0)
      stream.push(Buffer.from(chunk))
  })

  ipcMain.handle('audio:stopStream', async (_, { guildId }) => {
    const stream = audioStreams.get(guildId)
    if (stream) {
      audioStreams.delete(guildId)
      stream.end()
    }
    api.player.stopStream(guildId)
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

    browserViews.set(id, view)

    await view.webContents.loadURL(url).catch(() => {})

    // Send initial title after page loads
    const initialTitle = view.webContents.getTitle()
    if (initialTitle && mainWindow)
      mainWindow.webContents.send('browserView:titleUpdated', id, initialTitle)

    return id
  })

  ipcMain.handle('browserView:destroy', async (_, { id }) => {
    const view = browserViews.get(id)
    if (!view)
      return
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
      await view.webContents.loadURL(url).catch(() => {})
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
      const stream = fs.createReadStream(filePath, { start, end })
      return new Response(stream, {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(chunkSize),
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }
  }

  // Use streaming instead of readFileSync to avoid blocking the main thread
  const stream = fs.createReadStream(filePath)
  return new Response(stream, {
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
          if (!fs.existsSync(filePath))
            return new Response('Not Found', { status: 404 })
          return serveSoundFile(request, filePath)
        }).catch(() => new Response('Not Found', { status: 404 }))
      }
    }

    if (host === 'app') {
      const filePath = pathname === '/' ? path.join(webDistDir, 'index.html') : path.join(webDistDir, pathname)
      if (!fs.existsSync(filePath))
        return new Response('Not Found', { status: 404 })
      const stream = fs.createReadStream(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }[ext] || 'application/octet-stream'
      return new Response(stream, { headers: { 'Content-Type': mime } })
    }

    return new Response('Not Found', { status: 404 })
  })
}

app.whenReady().then(async () => {
  // Show splash screen immediately for better UX
  createSplashWindow()

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
    const embedded = await getEmbeddedApp()
    handle = embedded
    api = embedded.api
  }
  catch (err) {
    console.error('Failed to start embedded app:', err)
    if (splashWindow && !splashWindow.isDestroyed())
      splashWindow.close()
    app.quit(1)
    return
  }
  appHandle = handle

  const webDistDir = path.join(botRoot, 'web-dist')
  if (!fs.existsSync(path.join(webDistDir, 'index.html'))) {
    console.error('web-dist/index.html not found. Run: pnpm run build')
    if (splashWindow && !splashWindow.isDestroyed())
      splashWindow.close()
    app.quit(1)
    return
  }

  registerIpcHandlers(api)
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

  createWindow('hibiki://app/')
}).catch((err) => {
  console.error('Electron app.whenReady failed:', err)
  if (splashWindow && !splashWindow.isDestroyed())
    splashWindow.close()
  app.quit(1)
})

app.on('window-all-closed', () => {
  if (appHandle?.close)
    appHandle.close().catch(() => {})
  appHandle = null
  app.quit()
})

app.on('before-quit', () => {
  if (appHandle?.close)
    appHandle.close().catch(() => {})
  appHandle = null
})
