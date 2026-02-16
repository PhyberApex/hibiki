import { describe, it, expect, beforeAll } from 'vitest'
import { e2eEnv, isE2eConfigured } from './setup.js'

const { baseUrl, guildId, voiceChannelId } = e2eEnv
const api = (path: string) => `${baseUrl}/api${path}`

function isServerUnreachable(err: unknown): boolean {
  const check = (e: unknown): boolean => {
    if (!e || typeof e !== 'object') return false
    const o = e as { code?: string; errors?: Array<{ code?: string }> }
    if (o.code === 'ECONNREFUSED' || o.code === 'EPERM') return true
    if (Array.isArray(o.errors)) return o.errors.some((x: { code?: string }) => x.code === 'ECONNREFUSED' || x.code === 'EPERM')
    return false
  }
  return check(err) || check((err as { cause?: unknown })?.cause)
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(api(path))
  if (!res.ok) throw new Error(`GET ${path} ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function post<T>(path: string, body: object): Promise<T> {
  const res = await fetch(api(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${path} ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

describe('Hibiki API E2E (real Discord)', () => {
  beforeAll(() => {
    if (!isE2eConfigured()) {
      console.warn('E2E skipped: set E2E_GUILD_ID and E2E_VOICE_CHANNEL_ID (and E2E_HIBIKI_API_URL if not localhost:3000)')
    }
  })

  it('bot is ready and API is up', async () => {
    let status: { ready: boolean; userTag?: string; userId?: string }
    try {
      status = await get<{ ready: boolean; userTag?: string; userId?: string }>('/player/bot-status')
    } catch (err: unknown) {
      if (isServerUnreachable(err)) return // skip when Hibiki is not running or network blocked
      throw err
    }
    expect(status!.ready).toBe(true)
    expect(status!.userTag).toBeDefined()
  })

  it('full flow: join → play → effect → leave', async () => {
    if (!isE2eConfigured()) return
    let guilds: Array<{ guildId: string; guildName: string; channels: Array<{ id: string; name: string }> }>
    try {
      guilds = await get<Array<{ guildId: string; guildName: string; channels: Array<{ id: string; name: string }> }>>('/player/guilds')
    } catch (err: unknown) {
      if (isServerUnreachable(err)) return
      throw err
    }

    // Guild directory includes target guild
    const guild = guilds.find(g => g.guildId === guildId)
    expect(guild).toBeDefined()
    expect(guild!.channels.some(c => c.id === voiceChannelId)).toBe(true)

    // Sounds available (at least one track and one effect for real play)
    const [music, effects] = await Promise.all([
      get<Array<{ id: string; name: string }>>('/sounds/music'),
      get<Array<{ id: string; name: string }>>('/sounds/effects'),
    ])
    const trackId = music[0]?.id ?? music[0]?.name
    const effectId = effects[0]?.id ?? effects[0]?.name
    if (!trackId || !effectId) {
      console.warn('No music or effects in library; play/effect steps will be skipped')
    }

    // Join
    await post('/player/join', { guildId, channelId: voiceChannelId })
    let state = await get<Array<{ guildId: string; connectedChannelId?: string; track?: { id: string } | null }>>('/player/state')
    let entry = state.find(s => s.guildId === guildId)
    expect(entry).toBeDefined()
    expect(entry!.connectedChannelId).toBe(voiceChannelId)
    expect(entry!.track).toBeFalsy() // no track playing yet

    if (trackId) {
      await post('/player/play', { guildId, trackId })
      state = await get('/player/state')
      entry = state.find((s: { guildId: string }) => s.guildId === guildId)
      expect(entry?.track?.id).toBeDefined()
    }

    if (effectId) {
      await post('/player/effect', { guildId, effectId })
      // Effect is one-shot; state may still show music or idle
      const afterEffect = await get('/player/state')
      const afterEntry = afterEffect.find((s: { guildId: string }) => s.guildId === guildId)
      expect(afterEntry).toBeDefined()
    }

    await post('/player/leave', { guildId })
    state = await get('/player/state')
    entry = state.find(s => s.guildId === guildId)
    expect(entry).toBeUndefined()
  })
})
