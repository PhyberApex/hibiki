import { useElectronApi } from './electron'

function requireElectron(): void {
  if (!useElectronApi())
    throw new Error('Hibiki runs as an Electron app. Open it via pnpm run electron.')
}

export interface StreamMetadata {
  id: string
  name: string
  filename: string
  category: string
}

export function startAudioStream(
  guildId: string,
  metadata?: StreamMetadata,
  streamId?: string,
): Promise<void> {
  requireElectron()
  if (!window.hibiki?.invoke)
    throw new Error('Electron API not available')
  return window.hibiki.invoke('audio:startStream', { guildId, metadata, streamId }) as Promise<void>
}

export function stopAudioStream(guildId: string, streamId?: string): Promise<void> {
  requireElectron()
  if (!window.hibiki?.invoke)
    throw new Error('Electron API not available')
  return window.hibiki.invoke('audio:stopStream', { guildId, streamId }) as Promise<void>
}

export function sendAudioChunk(guildId: string, chunk: ArrayBuffer, streamId?: string): void {
  requireElectron()
  if (typeof window.hibiki?.send !== 'function')
    throw new Error('Electron send not available')
  window.hibiki.send('audio:chunk', { guildId, chunk, streamId })
}

export function sendEffectChunk(guildId: string, chunk: ArrayBuffer, streamId?: string): void {
  requireElectron()
  if (typeof window.hibiki?.send !== 'function')
    throw new Error('Electron send not available')
  window.hibiki.send('audio:effectChunk', { guildId, streamId, chunk })
}

export function stopEffectStream(guildId: string, streamId?: string): Promise<void> {
  requireElectron()
  if (!window.hibiki?.invoke)
    throw new Error('Electron API not available')
  return window.hibiki.invoke('audio:stopEffectStream', { guildId, streamId }) as Promise<void>
}

/** Starts an effect-lane stream; `volume` is the absolute initial 0–100 level (the backend's effects default when omitted). */
export function startEffectStream(guildId: string, streamId?: string, volume?: number): Promise<string> {
  requireElectron()
  if (!window.hibiki?.invoke)
    throw new Error('Electron API not available')
  return window.hibiki.invoke('audio:startEffectStream', { guildId, streamId, volume }) as Promise<string>
}

/** Sets a keyed effect-lane stream's absolute 0–100 volume live (a Routed Tab under a Discord Target). */
export function setEffectStreamVolume(guildId: string, streamId: string, volume: number): Promise<void> {
  requireElectron()
  if (!window.hibiki?.invoke)
    throw new Error('Electron API not available')
  return window.hibiki.invoke('audio:setEffectStreamVolume', { guildId, streamId, volume }) as Promise<void>
}
