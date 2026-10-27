import { useElectronApi } from './electron'

/** Absolute path of the main-process log file, or `null` outside Electron. */
export async function fetchLogPath(): Promise<string | null> {
  if (!useElectronApi())
    return null
  const result = await window.hibiki!.invoke('logs:getPath')
  return typeof result === 'string'
    ? result
    : null
}

export async function openLogFolder(): Promise<void> {
  if (!useElectronApi())
    return
  await window.hibiki!.invoke('logs:openFolder')
}
