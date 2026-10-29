const { createLogger } = require('./logger')

const log = createLogger('window')

/**
 * What a log line may say about a URL: its origin, or its scheme when it has
 * no origin (`file:`, `data:`, custom schemes). Never the path or query,
 * which can carry tokens.
 */
function describeUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.origin !== 'null'
      ? parsed.origin
      : parsed.protocol
  }
  catch {
    return 'an unparseable URL'
  }
}

/** Scheme and host of `url`; `URL#origin` is `'null'` for custom schemes like `hibiki:`. */
function schemeAndHost(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`
  }
  catch {
    return null
  }
}

/**
 * Keeps the main window on the app it loaded (#638). The window carries the
 * preload, so any page it navigates to, or opens as a child window, would
 * get the whole `api` channel. `window.open` and `target="_blank"` links to
 * http(s) go to the system browser instead; everything else is denied.
 * In-app navigation stays allowed on `appUrl`'s scheme and host, which also
 * covers an http dev server.
 */
function guardMainWindowNavigation(webContents, { appUrl, openExternal }) {
  const appOrigin = schemeAndHost(appUrl)

  webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      log.info(`Opening ${describeUrl(url)} in the system browser`)
      Promise.resolve(openExternal(url)).catch(err => log.warn(`Could not open ${describeUrl(url)} in the system browser`, err))
    }
    else {
      log.warn(`Blocked a new window to ${describeUrl(url)}`)
    }
    return { action: 'deny' }
  })

  webContents.on('will-navigate', (event) => {
    if (appOrigin !== null && schemeAndHost(event.url) === appOrigin)
      return
    event.preventDefault()
    log.warn(`Blocked navigation of the main window to ${describeUrl(event.url)}`)
  })
}

module.exports = { describeUrl, guardMainWindowNavigation }
