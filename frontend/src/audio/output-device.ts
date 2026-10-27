import type { LocalOutputDevice } from '@/api/config'
import { fetchLocalOutputDevice } from '@/api/config'
import { logInfo } from './audio-element-diagnostics'

/**
 * The Local Target's Output Device (CONTEXT.md): resolves the stored choice
 * against the devices that are connected right now and tells subscribers
 * (the Local sink, m4a fallback `<audio>` elements) which sink id to use.
 * `''` is the system default.
 */

export interface OutputDeviceInfo {
  deviceId: string
  label: string
}

export interface ResolvedOutputDevice {
  sinkId: string
  /** Label of the stored device when it is not connected and the system default is used instead. */
  missingLabel?: string
}

/** Stored id if present, otherwise the system default with the missing label flagged. */
export function resolveOutputDevice(choice: LocalOutputDevice | null, devices: readonly OutputDeviceInfo[]): ResolvedOutputDevice {
  if (!choice)
    return { sinkId: '' }
  if (devices.some(d => d.deviceId === choice.deviceId))
    return { sinkId: choice.deviceId }
  return { sinkId: '', missingLabel: choice.label || choice.deviceId }
}

/** Connected `audiooutput` devices; the `default` alias is the "System default" entry, not a device. Empty labels become "Output device N". */
export function listOutputDevices(all: readonly MediaDeviceInfo[]): OutputDeviceInfo[] {
  return all
    .filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Output device ${i + 1}` }))
}

export interface OutputDeviceRouterDeps {
  /** Called once per absence of the stored device. */
  onMissing: (label: string) => void
}

export class OutputDeviceRouter {
  private choice: LocalOutputDevice | null = null
  /** `null` until the first enumeration, so a stored choice is not reported missing before the list exists. */
  private devices: OutputDeviceInfo[] | null = null
  private resolved: ResolvedOutputDevice = { sinkId: '' }
  private warnedAbsent = false
  private readonly listeners = new Set<(sinkId: string) => void>()

  constructor(private readonly deps: OutputDeviceRouterDeps) {}

  get sinkId(): string {
    return this.resolved.sinkId
  }

  subscribe(listener: (sinkId: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setChoice(choice: LocalOutputDevice | null): void {
    this.choice = choice
    this.warnedAbsent = false
    this.recompute()
  }

  setDevices(devices: OutputDeviceInfo[]): void {
    this.devices = devices
    this.recompute()
  }

  private recompute(): void {
    if (!this.devices)
      return
    const previous = this.resolved
    const next = resolveOutputDevice(this.choice, this.devices)
    this.resolved = next
    if (next.missingLabel !== undefined) {
      if (!this.warnedAbsent) {
        this.warnedAbsent = true
        this.deps.onMissing(next.missingLabel)
      }
    }
    else {
      if (this.warnedAbsent && this.choice)
        logInfo(`[output-device] ${this.choice.label || this.choice.deviceId} is back, routing to it`)
      this.warnedAbsent = false
    }
    if (next.sinkId !== previous.sinkId) {
      logInfo(`[output-device] local output now ${next.sinkId === ''
        ? 'the system default'
        : `"${this.choice?.label}" (${next.sinkId})`}`)
      this.listeners.forEach(l => l(next.sinkId))
    }
  }
}

let toastMissing: (label: string) => void = () => {}

export const outputDeviceRouter = new OutputDeviceRouter({
  onMissing: label => toastMissing(label),
})

/** Routes `<audio>` elements through the router; weakly held so transient Effect elements do not leak. */
const boundElements = new Set<WeakRef<HTMLAudioElement>>()

function applyToElement(el: HTMLAudioElement, sinkId: string): void {
  const target = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }
  if (typeof target.setSinkId !== 'function')
    return
  target.setSinkId(sinkId).catch((err) => {
    console.warn('[output-device] could not route an audio element:', err)
  })
}

export function bindAudioElement(el: HTMLAudioElement): void {
  boundElements.add(new WeakRef(el))
  if (outputDeviceRouter.sinkId !== '')
    applyToElement(el, outputDeviceRouter.sinkId)
}

outputDeviceRouter.subscribe((sinkId) => {
  for (const ref of boundElements) {
    const el = ref.deref()
    if (el)
      applyToElement(el, sinkId)
    else
      boundElements.delete(ref)
  }
})

/** Loads the stored choice, keeps the device list current, and wires the "not found" warning to `notify`. Returns an unsubscribe. */
export function installOutputDevice(notify: (label: string) => void): () => void {
  const md = navigator.mediaDevices
  if (!md?.enumerateDevices)
    return () => {}
  toastMissing = notify
  const refresh = async () => {
    try {
      outputDeviceRouter.setDevices(listOutputDevices(await md.enumerateDevices()))
    }
    catch (err) {
      console.warn('[output-device] could not list output devices:', err)
    }
  }
  md.addEventListener('devicechange', refresh)
  // Choice first so the first device list resolves against it.
  void fetchLocalOutputDevice()
    .catch((err) => {
      console.warn('[output-device] could not load the stored Output Device:', err)
      return null
    })
    .then((choice) => {
      outputDeviceRouter.setChoice(choice)
      return refresh()
    })
  return () => md.removeEventListener('devicechange', refresh)
}
