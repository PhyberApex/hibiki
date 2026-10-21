import type { UsageStatsGate, UsageStatsPayload } from './usage-stats'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUsageStatsSettings } from '../config/usage-stats-settings'
import { createAppConfig } from '../persistence'
import { buildUserAgent, createUsageStats, resolveUsageStatsHost, USAGE_STATS_HOST } from './usage-stats'

const ENVIRONMENT = { appVersion: '1.7.0', electronVersion: '41.0.0', platform: 'linux', arch: 'x64', locale: 'en-US' }

function makeConfig() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'hibiki-usage-stats-'))
  return {
    discord: { token: '' },
    audio: {
      storageRoot: tempRoot,
      musicDir: join(tempRoot, 'music'),
      effectsDir: join(tempRoot, 'effects'),
      ambienceDir: join(tempRoot, 'ambience'),
      webDistDir: 'web-dist',
    },
    database: { path: join(tempRoot, 'data', 'hibiki.json') },
  }
}

function setup(options: { gate?: UsageStatsGate, send?: (payload: UsageStatsPayload) => Promise<void>, timeoutMs?: number, environment?: Partial<typeof ENVIRONMENT> } = {}) {
  const config = makeConfig()
  const sent: UsageStatsPayload[] = []
  const sender = {
    send: jest.fn(async (payload: UsageStatsPayload) => {
      sent.push(payload)
      await options.send?.(payload)
    }),
  }
  const usageStats = createUsageStats({
    settings: createUsageStatsSettings(createAppConfig(config)),
    sender,
    gate: options.gate ?? { packaged: true, killSwitch: false },
    environment: { ...ENVIRONMENT, ...options.environment },
    timeoutMs: options.timeoutMs,
  })
  const appConfigFile = join(config.audio.storageRoot, 'data', 'app-config.json')
  const stored = () => {
    try {
      return JSON.parse(readFileSync(appConfigFile, 'utf-8'))
    }
    catch {
      return {}
    }
  }
  return { usageStats, sent, sender, stored }
}

const flush = () => new Promise(resolve => setImmediate(resolve))

const SCENE_PLAY = { name: 'scene-play', url: '/scenes/:id', data: { musicMode: 'shuffle', music: 3, ambience: 2, effects: 5, target: 'local' } }

describe('createUsageStats', () => {
  let warn: jest.SpyInstance
  let debug: jest.SpyInstance
  let info: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    debug = jest.spyOn(console, 'debug').mockImplementation(() => {})
    info = jest.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => jest.restoreAllMocks())

  it('is off by default: drops everything and stores nothing', async () => {
    const { usageStats, sent, stored } = setup()
    expect(await usageStats.getSettings()).toEqual({ enabled: false, prompted: false })
    await usageStats.track(SCENE_PLAY)
    await usageStats.track({ name: 'app-start' })
    await flush()
    expect(sent).toEqual([])
    expect(stored()).toEqual({})
  })

  it('sends app-start once with the environment data when switched on', async () => {
    const { usageStats, sent } = setup()
    await usageStats.setEnabled(true)
    await usageStats.setEnabled(true)
    await flush()
    expect(sent).toEqual([{
      name: 'app-start',
      url: '/',
      hostname: 'app.hibiki.phyberapex.de',
      data: { platform: 'linux', arch: 'x64', version: '1.7.0', locale: 'en-US' },
    }])
  })

  it('builds app-start from the environment, whatever the caller passes', async () => {
    const { usageStats, sent } = setup()
    await usageStats.setEnabled(true)
    sent.length = 0
    await usageStats.track({ name: 'app-start', data: { platform: 'my-guild', guildId: '123' } })
    await flush()
    expect(sent[0].data).toEqual({ platform: 'linux', arch: 'x64', version: '1.7.0', locale: 'en-US' })
  })

  it.each([
    ['zh-Hant-TW', 'zh-TW'],
    ['es-419', 'es-419'],
    ['de', 'de'],
  ])('reduces locale %s to %s instead of losing app-start', async (locale, sentLocale) => {
    const { usageStats, sent } = setup({ environment: { locale } })
    await usageStats.setEnabled(true)
    await flush()
    expect(sent[0].data.locale).toBe(sentLocale)
  })

  it('leaves out an arch the allowlist does not know but still counts the launch', async () => {
    const { usageStats, sent } = setup({ environment: { arch: 'riscv64' } })
    await usageStats.setEnabled(true)
    await flush()
    expect(sent[0].data).toEqual({ platform: 'linux', version: '1.7.0', locale: 'en-US' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('sends nothing when switched off, and nothing afterwards', async () => {
    const { usageStats, sent } = setup()
    await usageStats.setEnabled(true)
    await flush()
    sent.length = 0
    await usageStats.setEnabled(false)
    await usageStats.track(SCENE_PLAY)
    await flush()
    expect(sent).toEqual([])
    expect(await usageStats.getSettings()).toEqual({ enabled: false, prompted: false })
  })

  it('marks the invitation answered without enabling or sending', async () => {
    const { usageStats, sent } = setup()
    expect(await usageStats.markPrompted()).toEqual({ enabled: false, prompted: true })
    await flush()
    expect(sent).toEqual([])
  })

  it.each([
    ['an unpackaged build', { packaged: false, killSwitch: false }],
    ['the kill switch', { packaged: true, killSwitch: true }],
  ])('never sends under %s, even when enabled', async (_, gate) => {
    const { usageStats, sent } = setup({ gate })
    await usageStats.setEnabled(true)
    await usageStats.track(SCENE_PLAY)
    await flush()
    expect(sent).toEqual([])
    expect(info).toHaveBeenCalledWith('[usage-stats]', expect.stringContaining('will never be sent'))
  })

  it('sends an allowed event with the url and hostname', async () => {
    const { usageStats, sent } = setup()
    await usageStats.setEnabled(true)
    sent.length = 0
    await usageStats.track(SCENE_PLAY)
    await usageStats.track({ name: 'routed-tab-toggle', url: '/browser', data: { routed: true, target: 'discord' } })
    await flush()
    expect(sent).toEqual([
      { ...SCENE_PLAY, hostname: 'app.hibiki.phyberapex.de' },
      { name: 'routed-tab-toggle', url: '/browser', hostname: 'app.hibiki.phyberapex.de', data: { routed: true, target: 'discord' } },
    ])
    expect(debug).toHaveBeenCalledWith('[usage-stats]', 'Sending scene-play (url /scenes/:id):', JSON.stringify(SCENE_PLAY.data))
  })

  it.each([
    ['an unknown event name', { name: 'page-view' }, 'unknown event "page-view"'],
    ['an unknown data key', { name: 'hotkey-fired', data: { kind: 'scene', extra: 1 } }, 'key that is not allowed: "extra"'],
    ['a forbidden key', { name: 'scene-play', data: { guildId: '123456789' } }, 'key that is not allowed: "guildId"'],
    ['an out-of-enum value', { name: 'target-switch', data: { target: 'my secret server' } }, 'outside the allowlist for key "target"'],
    ['a non-integer count', { name: 'scene-play', data: { music: 1.5 } }, 'outside the allowlist for key "music"'],
    ['a route that is not a view pattern', { name: 'target-switch', url: '/scenes/2f7c', data: { target: 'local' } }, 'unknown url'],
  ])('drops %s with a warn that never names the value', async (_, event, reason) => {
    const { usageStats, sent } = setup()
    await usageStats.setEnabled(true)
    sent.length = 0
    await usageStats.track(event)
    await flush()
    expect(sent).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    const message = warn.mock.calls[0].join(' ')
    expect(message).toContain(reason)
    expect(message).not.toContain('123456789')
    expect(message).not.toContain('my secret server')
    expect(message).not.toContain('2f7c')
  })

  it('a failing send never throws, warns once and then debugs', async () => {
    const { usageStats, sender } = setup({
      send: async () => {
        throw new Error('offline')
      },
    })
    await expect(usageStats.setEnabled(true)).resolves.toEqual({ enabled: true, prompted: false })
    await flush()
    await usageStats.track(SCENE_PLAY)
    await flush()
    expect(sender.send).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toContain('Sending app-start failed')
    expect(debug).toHaveBeenCalledWith('[usage-stats]', expect.stringContaining('Sending scene-play failed'), expect.any(Error))
  })

  it('gives up on a hanging send after the timeout, without retrying', async () => {
    jest.useFakeTimers()
    try {
      const { usageStats, sender } = setup({ send: () => new Promise(() => {}), timeoutMs: 5000 })
      await usageStats.setEnabled(true)
      await jest.advanceTimersByTimeAsync(5000)
      expect(sender.send).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith('[usage-stats]', expect.stringContaining('Sending app-start failed'), expect.objectContaining({ message: 'timed out after 5000 ms' }))
    }
    finally {
      jest.useRealTimers()
    }
  })

  it('track resolves before the send settles', async () => {
    const pending: (() => void)[] = []
    const { usageStats, sent } = setup({
      send: () => new Promise<void>((resolve) => {
        pending.push(resolve)
      }),
    })
    await usageStats.setEnabled(true)
    await usageStats.track(SCENE_PLAY)
    await flush()
    expect(sent).toHaveLength(2)
    pending.forEach(settle => settle())
  })
})

describe('buildUserAgent', () => {
  it('names Hibiki, its version, Electron and the OS', () => {
    expect(buildUserAgent(ENVIRONMENT)).toBe('Hibiki/1.7.0 (Electron/41.0.0; Linux x86_64)')
    expect(buildUserAgent({ ...ENVIRONMENT, platform: 'win32' })).toBe('Hibiki/1.7.0 (Electron/41.0.0; Windows NT 10.0 x86_64)')
    expect(buildUserAgent({ ...ENVIRONMENT, platform: 'darwin', arch: 'arm64' })).toBe('Hibiki/1.7.0 (Electron/41.0.0; Macintosh arm64)')
  })
})

describe('resolveUsageStatsHost', () => {
  it('uses the project instance unless overridden', () => {
    expect(resolveUsageStatsHost(undefined)).toBe(USAGE_STATS_HOST)
    expect(resolveUsageStatsHost('  ')).toBe(USAGE_STATS_HOST)
    expect(resolveUsageStatsHost('http://localhost:3000')).toBe('http://localhost:3000')
  })
})
