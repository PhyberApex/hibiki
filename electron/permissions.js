const { createLogger } = require('./logger')
const { describeUrl, schemeAndHost } = require('./navigation-guard')

const log = createLogger('permissions')

/** Where the renderer runs; Browser tabs share its session, so the origin is what tells them apart. */
const APP_ORIGIN = 'hibiki://app'

/**
 * What the renderer needs: `display-capture` for Routed Tab capture
 * (`getUserMedia` with `chromeMediaSource: 'tab'`), `media` for
 * `enumerateDevices`, `speaker-selection` for `setSinkId`.
 */
const APP_PERMISSIONS = new Set(['display-capture', 'media', 'speaker-selection'])

function isAllowed(permission, url) {
  return APP_PERMISSIONS.has(permission) && schemeAndHost(url) === APP_ORIGIN
}

/**
 * The session's permission policy (#706). Electron grants every permission
 * when no handler is installed, and Browser tabs share the renderer's
 * session, so any page a GM opened would get the microphone, camera,
 * geolocation and the like without a prompt. Only the app origin gets
 * `APP_PERMISSIONS`; everything else is denied and logged. `getDisplayMedia`
 * is refused outright: the renderer captures Routed Tabs with `getUserMedia`.
 *
 * Media requests are judged by `details.securityOrigin`, the origin that called
 * `getUserMedia`. For tab capture Chromium builds the permission request on
 * the captured tab's frame (`MediaStreamManager` hands the target's render
 * ids to `CreateTabCaptureUIRequest`) while `security_origin` stays the
 * caller's, so `requestingUrl` names the Browser tab page even when the
 * renderer asked.
 */
function createPermissionPolicy() {
  // Chromium runs permission checks on every `navigator.permissions.query`
  // and device listing, so a denied check is logged once per origin.
  const loggedChecks = new Set()

  return {
    requestHandler(_webContents, permission, callback, details) {
      const url = details?.securityOrigin || details?.requestingUrl
      if (isAllowed(permission, url)) {
        if (permission === 'display-capture')
          log.info(`Granted tab capture to ${describeUrl(url)}`)
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
      callback(null)
    },
  }
}

/** Installs the permission policy on `session` (the default session the renderer and Browser tabs share). */
function installPermissionPolicy(session) {
  const policy = createPermissionPolicy()
  session.setPermissionRequestHandler(policy.requestHandler)
  session.setPermissionCheckHandler(policy.checkHandler)
  session.setDisplayMediaRequestHandler(policy.displayMediaHandler)
  log.info(`Permission policy installed: ${APP_ORIGIN} gets ${[...APP_PERMISSIONS].join(', ')}, every other request and all getDisplayMedia are denied`)
}

module.exports = {
  createPermissionPolicy,
  installPermissionPolicy,
}
