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

/** What a log line may say about a URL handed to `shell.openExternal`: its scheme alone. */
function describeScheme(url) {
  try {
    return new URL(url).protocol
  }
  catch {
    return 'an unparseable URL'
  }
}

/** Whether `url` is a web page the system browser should open; the only kind Hibiki ever hands to `shell.openExternal`. */
function isWebUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
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
 * Whether `url` stays on the app whose scheme and host is `appOrigin`; the
 * one rule both the guard and the release listener judge a navigation by.
 */
function staysOnApp(appOrigin, url) {
  return appOrigin !== null && schemeAndHost(url) === appOrigin
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
    if (isWebUrl(url)) {
      log.info(`Opening ${describeUrl(url)} in the system browser`)
      Promise.resolve(openExternal(url)).catch(err => log.warn(`Could not open ${describeUrl(url)} in the system browser`, err))
    }
    else {
      log.warn(`Blocked a new window to ${describeUrl(url)}`)
    }
    return { action: 'deny' }
  })

  webContents.on('will-navigate', (event) => {
    if (staysOnApp(appOrigin, event.url))
      return
    event.preventDefault()
    log.warn(`Blocked navigation of the main window to ${describeUrl(event.url)}`)
  })
}

/**
 * `did-start-navigation` listener that hands main-frame URLs to `send`.
 * Reads the `details` object: the positional `(event, url, isInPlace,
 * isMainFrame)` arguments are deprecated, and once removed `isMainFrame`
 * would be `undefined` and the tab URL bar would stop updating (#660).
 */
function forwardMainFrameNavigation(send) {
  return (details) => {
    if (details.isMainFrame)
      send(details.url)
  }
}

/**
 * Main window `did-start-navigation` listener that calls `release` when the
 * renderer is about to be replaced (a reload, crash recovery). Chromium
 * emits `did-start-navigation` before `will-navigate`, so a navigation off
 * `appUrl`'s scheme and host reaches it too, although
 * `guardMainWindowNavigation` cancels it and the renderer stays; releasing
 * then would cut its streams and Browser tabs (#707). `isSameDocument`
 * excludes the router's pushState navigations.
 */
function releaseOnMainFrameNavigation({ appUrl, release }) {
  const appOrigin = schemeAndHost(appUrl)
  return (details) => {
    if (!details.isMainFrame || details.isSameDocument)
      return
    if (!staysOnApp(appOrigin, details.url)) {
      log.debug(`Kept renderer resources: navigation to ${describeUrl(details.url)} leaves the app and will be blocked`)
      return
    }
    release()
  }
}

module.exports = {
  describeScheme,
  describeUrl,
  forwardMainFrameNavigation,
  guardMainWindowNavigation,
  isWebUrl,
  releaseOnMainFrameNavigation,
  schemeAndHost,
}
