const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hibiki', {
  platform: process.platform,
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => ipcRenderer.send(channel, ...args),
  on: (channel, callback) => {
    const listener = (_, ...args) => callback(...args)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
})
