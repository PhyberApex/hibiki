import { useElectronApi } from './electron'

type Bridge = NonNullable<Window['hibiki']>

/** The preload bridge; `useElectronApi()` has already checked that it can `invoke`. */
function requireElectron(): Bridge {
  if (!useElectronApi())
    throw new Error('Hibiki runs as an Electron app. Open it via pnpm run electron.')
  return window.hibiki as Bridge
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
  return requireElectron().invoke('audio:startStream', { guildId, metadata, streamId }) as Promise<void>
}

export function stopAudioStream(guildId: string, streamId?: string): Promise<void> {
  return requireElectron().invoke('audio:stopStream', { guildId, streamId }) as Promise<void>
}

export function sendAudioChunk(guildId: string, chunk: ArrayBuffer, streamId?: string): void {
  const hibiki = requireElectron()
  if (typeof hibiki.send !== 'function')
    throw new Error('Electron send not available')
  hibiki.send('audio:chunk', { guildId, chunk, streamId })
}

export function sendEffectChunk(guildId: string, chunk: ArrayBuffer, streamId?: string): void {
  const hibiki = requireElectron()
  if (typeof hibiki.send !== 'function')
    throw new Error('Electron send not available')
  hibiki.send('audio:effectChunk', { guildId, streamId, chunk })
}

export function stopEffectStream(guildId: string, streamId?: string): Promise<void> {
  return requireElectron().invoke('audio:stopEffectStream', { guildId, streamId }) as Promise<void>
}

/** Starts an effect-lane stream; `volume` is the absolute initial 0–100 level (the backend's effects default when omitted). */
export function startEffectStream(guildId: string, streamId?: string, volume?: number): Promise<string> {
  return requireElectron().invoke('audio:startEffectStream', { guildId, streamId, volume }) as Promise<string>
}

/** Sets a keyed effect-lane stream's absolute 0–100 volume live (a Routed Tab under a Discord Target). */
export function setEffectStreamVolume(guildId: string, streamId: string, volume: number): Promise<void> {
  return requireElectron().invoke('audio:setEffectStreamVolume', { guildId, streamId, volume }) as Promise<void>
}
