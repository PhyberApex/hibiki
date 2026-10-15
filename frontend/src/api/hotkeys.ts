export interface HotkeyFailure {
  accelerator: string
  owner: string
  reason: string
}

/** What the main process managed to register: failures feed Settings → Diagnostics and the startup warning. */
export interface HotkeyStatus {
  enabled: boolean
  registered: string[]
  failures: HotkeyFailure[]
}

export function fetchHotkeyStatus(): Promise<HotkeyStatus> {
  if (!window.hibiki?.invoke)
    throw new Error('Electron API not available')
  return window.hibiki.invoke('hotkeys:getStatus') as Promise<HotkeyStatus>
}

/** Subscribes to `hotkey:fired`; returns the unsubscribe function. */
export function onHotkeyFired(callback: (accelerator: string) => void): () => void {
  if (!window.hibiki?.on)
    return () => {}
  return window.hibiki.on('hotkey:fired', (payload) => {
    const accelerator = (payload as { accelerator?: unknown } | undefined)?.accelerator
    if (typeof accelerator === 'string')
      callback(accelerator)
  })
}
