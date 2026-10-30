const { createLogger } = require('./logger')

const log = createLogger('app')

const ERROR_TITLE = 'Hibiki ran into an unexpected error'
const LOG_HINT = 'Details were written to the log file (Settings → Diagnostics).'

/**
 * Ends the process with exit code 1 after a fatal startup failure, so CI,
 * e2e and packaging smoke tests see it fail (#660). `app.quit()` takes no
 * exit code and always exits 0. `teardown` runs first because a failure
 * after the backend booted may already hold a Discord login and voice
 * connections; `app.exit` itself skips `before-quit`.
 */
async function exitWithError({ app, teardown }, message, err) {
  if (err === undefined)
    log.error(message)
  else
    log.error(message, err)
  try {
    await teardown()
  }
  catch (teardownErr) {
    log.error('Teardown after a fatal error failed', teardownErr)
  }
  app.exit(1)
}

/**
 * `uncaughtException` listener. Before `ready` nothing else could show the
 * error, so the blocking `showErrorBox` stays. After it, the backend mixer,
 * voice player and Local sink pump share this process, and a synchronous
 * modal would silence playback until the GM dismissed it (#660); the error
 * is logged and shown in an async message box instead, one at a time.
 */
function createUncaughtExceptionHandler({ dialog, isReady, getWindow }) {
  let boxOpen = false
  return (err) => {
    log.error('Uncaught exception in the main process:', err)
    const detail = `${err?.stack || err}\n\n${LOG_HINT}`
    if (!isReady()) {
      dialog.showErrorBox(ERROR_TITLE, detail)
      return
    }
    if (boxOpen)
      return
    boxOpen = true
    const options = {
      type: 'error',
      title: 'Hibiki',
      message: ERROR_TITLE,
      detail,
    }
    const win = getWindow()
    const shown = win && !win.isDestroyed()
      ? dialog.showMessageBox(win, options)
      : dialog.showMessageBox(options)
    Promise.resolve(shown)
      .catch(boxErr => log.warn('Could not show the error dialog', boxErr))
      .finally(() => { boxOpen = false })
  }
}

module.exports = { createUncaughtExceptionHandler, exitWithError }
