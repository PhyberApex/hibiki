export interface SoundFile {
  id: string
  name: string
  filename: string
  category: string
  path: string
}

async function request<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`)
  }
  if (response.status === 204) {
    return undefined as T
  }
  const text = await response.text()
  if (!text.trim()) {
    return undefined as T
  }
  return JSON.parse(text) as T
}

export function listMusic(signal?: AbortSignal) {
  return request<SoundFile[]>('/api/sounds/music', { signal })
}

export function listEffects(signal?: AbortSignal) {
  return request<SoundFile[]>('/api/sounds/effects', { signal })
}

export async function uploadSound(
  type: 'music' | 'effects',
  file: File,
  signal?: AbortSignal,
) {
  const body = new FormData()
  body.append('file', file)
  return request<SoundFile>(`/api/sounds/${type}`, {
    method: 'POST',
    body,
    signal,
  })
}

export function deleteSound(type: 'music' | 'effects', id: string, signal?: AbortSignal) {
  return request<void>(`/api/sounds/${type}/${id}`, {
    method: 'DELETE',
    signal,
  })
}

/** URL to stream a sound for playback (use in <audio src="...">) */
export function soundStreamUrl(type: 'music' | 'effects', id: string): string {
  return `/api/sounds/${type}/${id}/file`
}
