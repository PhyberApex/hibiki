export interface SoundFile {
  id: string
  name: string
  filename: string
  category: string
  path?: string
  createdAt?: string
  tags?: string[]
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

export function listMusic(tag?: string, signal?: AbortSignal) {
  const url = tag ? `/api/sounds/music?tag=${encodeURIComponent(tag)}` : '/api/sounds/music'
  return request<SoundFile[]>(url, { signal })
}

export function listEffects(tag?: string, signal?: AbortSignal) {
  const url = tag ? `/api/sounds/effects?tag=${encodeURIComponent(tag)}` : '/api/sounds/effects'
  return request<SoundFile[]>(url, { signal })
}

export function listMusicTags(signal?: AbortSignal) {
  return request<string[]>('/api/sounds/music/tags', { signal })
}

export function listEffectsTags(signal?: AbortSignal) {
  return request<string[]>('/api/sounds/effects/tags', { signal })
}

export function setSoundTags(
  type: 'music' | 'effects',
  id: string,
  tags: string[],
  signal?: AbortSignal,
) {
  return request<{ tags: string[] }>(`/api/sounds/${type}/${id}/tags`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags }),
    signal,
  })
}

export function setSoundName(
  type: 'music' | 'effects',
  id: string,
  name: string,
  signal?: AbortSignal,
) {
  return request<{ name: string }>(`/api/sounds/${type}/${id}/name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
    signal,
  })
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

/** Upload multiple files sequentially; returns results and any error per file. */
export async function uploadSoundsBulk(
  type: 'music' | 'effects',
  files: File[],
  signal?: AbortSignal,
): Promise<{ success: SoundFile[], failed: { file: File, error: Error }[] }> {
  const success: SoundFile[] = []
  const failed: { file: File, error: Error }[] = []
  for (const file of files) {
    try {
      const result = await uploadSound(type, file, signal)
      success.push(result)
    }
    catch (err) {
      failed.push({ file, error: err instanceof Error ? err : new Error(String(err)) })
    }
  }
  return { success, failed }
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
