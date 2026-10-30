const { createLogger } = require('./logger')
const { describeUrl } = require('./navigation-guard')

const log = createLogger('permissions')

/** Where the renderer runs; Browser tabs share its session, so the origin is what tells them apart. */
const APP_ORIGIN = 'hibiki://app'

/** What the renderer needs: `media` for Routed Tab capture and `enumerateDevices`, `speaker-selection` for `setSinkId`. */
const APP_PERMISSIONS = new Set(['media', 'speaker-selection'])

/** Whether `url` is on the app's scheme and host; `URL#origin` is `'null'` for custom schemes, so compare by hand. */
function isAppUrl(url) {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}` === APP_ORIGIN
  }
  catch {
    return false
  }
}

function isAllowed(permission, url) {
  return APP_PERMISSIONS.has(permission) && isAppUrl(url)
}

/**
 * The session's permission policy (#706). Electron grants every permission
 * when no handler is installed, and Browser tabs share the renderer's
 * session, so any page a GM opened would get the microphone, camera,
 * geolocation and the like without a prompt. Only the app origin gets
 * `APP_PERMISSIONS`; everything else is denied and logged. Screen capture is
 * refused outright: the renderer captures Routed Tabs with `getUserMedia`.
 */
function createPermissionPolicy() {
  // Chromium runs permission checks on every `navigator.permissions.query`
  // and device listing, so a denied check is logged once per origin.
  const loggedChecks = new Set()

  return {
    requestHandler(_webContents, permission, callback, details) {
      const url = details?.requestingUrl
      if (isAllowed(permission, url)) {
        callback(true)
        return
      }
      log.warn(`Denied ${permission} to ${describeUrl(url)}`)
      callback(false)
    },

    checkHandler(_webContents, permission, requestingOrigin) {
      if (isAllowed(permission, requestingOrigin))
        return true
      const origin = describeUrl(requestingOrigin)
      const key = `${permission} ${origin}`
      if (!loggedChecks.has(key)) {
        loggedChecks.add(key)
        log.warn(`Denied the ${permission} check to ${origin}`)
      }
      return false
    },

    displayMediaHandler(request, callback) {
      log.warn(`Refused screen capture (audio: ${request.audioRequested ? 'yes' : 'no'}) to ${describeUrl(request.securityOrigin)}`)
      callback({})
    },
  }
}

/** Installs the permission policy on `session` (the default session the renderer and Browser tabs share). */
function installPermissionPolicy(session) {
  const policy = createPermissionPolicy()
  session.setPermissionRequestHandler(policy.requestHandler)
  session.setPermissionCheckHandler(policy.checkHandler)
  session.setDisplayMediaRequestHandler(policy.displayMediaHandler)
  log.info(`Permission policy installed: ${APP_ORIGIN} gets media and speaker-selection, every other request and all screen capture is denied`)
}

module.exports = {
  createPermissionPolicy,
  installPermissionPolicy,
}
