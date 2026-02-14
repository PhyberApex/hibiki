export interface AllowlistConfig {
  allowedDiscordRoleIds: string[]
  allowedDiscordUserIds: string[]
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const text = await response.text()
    let message = `Request failed (${response.status})`
    try {
      const body = JSON.parse(text) as { message?: string | string[] }
      const msg = body.message
      if (typeof msg === 'string')
        message = msg
      else if (Array.isArray(msg) && msg.length)
        message = String(msg[0] ?? message)
    }
    catch {
      if (text)
        message = text
    }
    throw new Error(message)
  }
  if (response.status === 204)
    return undefined as T
  return response.json()
}

export function fetchPermissionsConfig(signal?: AbortSignal): Promise<AllowlistConfig> {
  return request('/api/permissions/config', { signal })
}

export function updatePermissionsConfig(
  config: AllowlistConfig,
): Promise<AllowlistConfig> {
  return request('/api/permissions/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  })
}
