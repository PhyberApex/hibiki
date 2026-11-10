const { contextBridge, ipcRenderer, webUtils } = require('electron')

// The renderer reaches main through these channels and no others (#774).
// The preload is sandboxed and cannot `require` a shared module, so the lists
// live here; `preload.spec.ts` checks them against every channel main registers
// and every channel the renderer uses. A new IPC channel is added here too.
const INVOKE_CHANNELS = new Set([
  'api',
  'audio:setEffectStreamVolume',
  'audio:startEffectStream',
  'audio:startStream',
  'audio:stopEffectStream',
  'audio:stopStream',
  'browserView:create',
  'browserView:destroy',
  'browserView:getMediaSourceId',
  'browserView:goBack',
  'browserView:goForward',
  'browserView:hide',
  'browserView:loadURL',
  'browserView:reload',
  'browserView:setAudioMuted',
  'browserView:setBounds',
  'browserView:show',
  'diagnostics:copy',
  'dialog:openFile',
  'dialog:saveFile',
  'dialog:selectFolder',
  'hotkeys:getStatus',
  'logs:getPath',
  'logs:openFolder',
  'shell:openExternal',
])

const SEND_CHANNELS = new Set([
  'audio:chunk',
  'audio:effectChunk',
])

const RECEIVE_CHANNELS = new Set([
  'audio:localSinkChunk',
  'audio:localSinkStart',
  'audio:localSinkStop',
  'browserView:didNavigate',
  'browserView:faviconUpdated',
  'browserView:mediaPlaying',
  'browserView:titleUpdated',
  'hotkey:fired',
  'player:stateChanged',
])

/** Throws, after leaving a trace in hibiki.log, when `channel` is not on `allowed`. */
function requireAllowed(allowed, kind, channel) {
  if (allowed.has(channel))
    return
  console.error(`[preload] Refused ${kind} on unknown channel ${String(channel)}`)
  throw new Error(`Unknown IPC channel: ${String(channel)}`)
}

contextBridge.exposeInMainWorld('hibiki', {
  platform: process.platform,
  invoke: (channel, ...args) => {
    try {
      requireAllowed(INVOKE_CHANNELS, 'invoke', channel)
    }
    catch (err) {
      return Promise.reject(err)
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  send: (channel, ...args) => {
    requireAllowed(SEND_CHANNELS, 'send', channel)
    ipcRenderer.send(channel, ...args)
  },
  on: (channel, callback) => {
    requireAllowed(RECEIVE_CHANNELS, 'on', channel)
    const listener = (_, ...args) => callback(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  getPathForFile: file => webUtils.getPathForFile(file),
})
