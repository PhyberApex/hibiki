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

/** Puts the redacted Diagnostics summary (environment, settings flags, log tail) on the clipboard; resolves to its line count. */
export async function copyDiagnostics(): Promise<{ lines: number }> {
  if (!useElectronApi())
    throw new Error('Electron API not available')
  return await window.hibiki!.invoke('diagnostics:copy') as { lines: number }
}
