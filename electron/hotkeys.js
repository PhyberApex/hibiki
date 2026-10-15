const path = require('node:path')
const { createLogger } = require('./logger')

const log = createLogger('hotkeys')

/**
 * Global hotkeys (ADR-0005): the main process only registers and forwards. It keeps
 * `globalShortcut` in step with the Scenes and hotkey settings, and tells the renderer
 * which accelerator fired; resolving it to an action is the renderer's job.
 */
function createHotkeys({ globalShortcut, getApi, getWindow }) {
  const { computeAccelerators, createHotkeyRegistrar } = require(path.join(__dirname, '..', 'dist', 'hotkeys', 'hotkey-registrar.js'))

  const registrar = createHotkeyRegistrar(
    {
      register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
      unregister: accelerator => globalShortcut.unregister(accelerator),
    },
    (accelerator) => {
      const win = getWindow()
      if (!win || win.isDestroyed()) {
        log.warn(`${accelerator} fired but there is no window to handle it`)
        return
      }
      log.info(`${accelerator} fired`)
      win.webContents.send('hotkey:fired', { accelerator })
    },
  )

  // Syncs run one at a time: a Scene save racing a settings change must not interleave registrations.
  let chain = Promise.resolve()

  function sync() {
    chain = chain.then(async () => {
      const api = getApi()
      if (!api)
        return
      const [scenes, settings] = await Promise.all([api.scenes.list(), api.config.getHotkeySettings()])
      registrar.sync(computeAccelerators(scenes, settings), settings.enabled)
    }).catch(err => log.error('Could not sync global hotkeys:', err))
    return chain
  }

  return { sync, releaseAll: () => registrar.releaseAll(), getStatus: () => registrar.getStatus() }
}

/** API calls after which the set of wanted accelerators may have changed. */
const HOTKEY_AFFECTING_CALLS = new Set([
  'scenes.save',
  'scenes.remove',
  'scenes.importScene',
  'registry.installFromRegistry',
  'config.setHotkeySettings',
])

module.exports = { createHotkeys, HOTKEY_AFFECTING_CALLS }
