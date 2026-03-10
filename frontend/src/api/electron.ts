declare global {
  interface Window {
    hibiki?: {
      platform: string
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      send: (channel: string, ...args: unknown[]) => void
      on: (channel: string, callback: (...args: unknown[]) => void) => () => void
    }
  }
}

export function useElectronApi(): boolean {
  return typeof window !== 'undefined' && typeof window.hibiki?.invoke === 'function'
}

export function apiCall<T>(domain: string, method: string, args: unknown[]): Promise<T> {
  if (!window.hibiki?.invoke)
    throw new Error('Electron API not available')
  return window.hibiki.invoke('api', { domain, method, args }) as Promise<T>
}
