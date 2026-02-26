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
): Promise<void> {
  requireElectron()
  if (!window.hibiki?.invoke)
    throw new Error('Electron API not available')
  return window.hibiki.invoke('audio:startStream', { guildId, metadata }) as Promise<void>
}

export function stopAudioStream(guildId: string): Promise<void> {
  requireElectron()
  if (!window.hibiki?.invoke)
    throw new Error('Electron API not available')
  return window.hibiki.invoke('audio:stopStream', { guildId }) as Promise<void>
}

export function sendAudioChunk(guildId: string, chunk: ArrayBuffer): void {
  requireElectron()
  if (typeof window.hibiki?.send !== 'function')
    throw new Error('Electron send not available')
  window.hibiki.send('audio:chunk', { guildId, chunk })
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

export function startEffectStream(guildId: string, streamId?: string): Promise<string> {
  requireElectron()
  if (!window.hibiki?.invoke)
    throw new Error('Electron API not available')
  return window.hibiki.invoke('audio:startEffectStream', { guildId, streamId }) as Promise<string>
}
