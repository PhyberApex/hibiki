const { createLogger } = require('./logger')
const { schemeAndHost } = require('./navigation-guard')

const log = createLogger('ipc')

/** Scheme and host of the one page allowed to talk to main: the app the main window loads. */
const APP_ORIGIN = 'hibiki://app'

/**
 * Whether an IPC `event` came from the app's own top-level frame (#774). The
 * preload is the only bridge, and only the main window carries it, but that
 * is one `webPreferences` line away from changing: this check makes every
 * handler refuse a Browser tab page, a sub-frame or any other origin on its
 * own. `senderFrame` is `null` once the frame navigated or was destroyed.
 */
function isTrustedSender(event) {
  const frame = event?.senderFrame
  if (!frame || frame.parent)
    return false
  return schemeAndHost(frame.url) === APP_ORIGIN
}

/** What a log line may say about a refused sender: its scheme and host, and whether it was a sub-frame. Never path or query. */
function describeSender(event) {
  const frame = event?.senderFrame
  if (!frame)
    return 'a destroyed frame'
  const where = schemeAndHost(frame.url) ?? 'an unparseable URL'
  return frame.parent
    ? `a sub-frame on ${where}`
    : where
}

// Chunk channels fire many times a second; warn once per channel and sender, bounded like ipc-streams' unknown-stream set.
const MAX_WARNED = 256

/**
 * `ipcMain`'s `handle` and `on`, refusing any sender `isTrustedSender` does
 * not trust before the handler runs. A refused `handle` rejects the
 * renderer's `invoke`; a refused `on` message is dropped.
 */
function createTrustedIpc(ipcMain) {
  const warned = new Set()
  return {
    handle: (channel, handler) => ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedSender(event)) {
        log.warn(`Refused ${channel} from ${describeSender(event)}`)
        throw new Error(`Refused ${channel}: untrusted sender`)
      }
      return handler(event, ...args)
    }),
    on: (channel, listener) => ipcMain.on(channel, (event, ...args) => {
      if (!isTrustedSender(event)) {
        const sender = describeSender(event)
        const key = `${channel} ${sender}`
        if (!warned.has(key)) {
          if (warned.size >= MAX_WARNED)
            warned.clear()
          warned.add(key)
          log.warn(`Dropped ${channel} from ${sender}`)
        }
        return
      }
      listener(event, ...args)
    }),
  }
}

module.exports = { APP_ORIGIN, createTrustedIpc, isTrustedSender }
