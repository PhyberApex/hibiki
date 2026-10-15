declare global {
  interface Window {
    hibiki?: {
      platform: string
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      send: (channel: string, ...args: unknown[]) => void
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void
      getPathForFile?: (file: File) => string
    }
  }
}

export function useElectronApi(): boolean {
  return typeof window !== 'undefined' && typeof window.hibiki?.invoke === 'function'
}

const IPC_ERROR_WRAPPER = /^Error invoking remote method '[^']*': (?:Error: )?/

/** Electron prefixes every rejected invoke with the channel it went through; the GM only needs the backend's sentence. */
export function unwrapIpcError(error: unknown): unknown {
  if (!(error instanceof Error))
    return error
  const message = error.message.replace(IPC_ERROR_WRAPPER, '')
  if (message === error.message)
    return error
  const unwrapped = new Error(message)
  unwrapped.cause = error
  return unwrapped
}

export function apiCall<T>(domain: string, method: string, args: unknown[]): Promise<T> {
  if (!window.hibiki?.invoke)
    throw new Error('Electron API not available')
  return (window.hibiki.invoke('api', { domain, method, args }) as Promise<T>)
    .catch((error: unknown) => { throw unwrapIpcError(error) })
}

export function openExternal(url: string): void {
  if (window.hibiki?.invoke)
    window.hibiki.invoke('shell:openExternal', url)
}

export function getPathForFile(file: File): string | null {
  const resolved = window.hibiki?.getPathForFile?.(file)
  return typeof resolved === 'string' && resolved.length > 0 ? resolved : null
}
