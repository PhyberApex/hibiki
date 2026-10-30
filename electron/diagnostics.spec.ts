import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// eslint-disable-next-line ts/no-require-imports
const { buildDiagnosticsSummary, readLogTail, LOG_TAIL_LINES } = require('./diagnostics')

const environment = {
  appVersion: '1.9.0',
  electronVersion: '40.1.0',
  nodeVersion: '24.3.0',
  platform: 'win32',
  arch: 'x64',
  locale: 'de-DE',
}

function fakeApi(overrides: Record<string, unknown> = {}) {
  return {
    config: {
      getActiveOutputTarget: jest.fn().mockResolvedValue('local'),
      getLocalOutputDevice: jest.fn().mockResolvedValue({ deviceId: 'abc123', label: 'USB Headset' }),
      getDiscord: jest.fn().mockResolvedValue({ tokenConfigured: true, encrypted: true, fromEnvironment: false }),
      getVision: jest.fn().mockResolvedValue({
        provider: 'openai-compatible',
        enabled: true,
        configured: true,
        claude: { keyConfigured: false, configured: false, encrypted: true },
        openaiCompatible: {
          keyConfigured: true,
          configured: true,
          encrypted: true,
          baseUrl: 'http://localhost:11434/v1',
          model: 'llava',
        },
      }),
      getUsageStats: jest.fn().mockResolvedValue({ enabled: false, prompted: true }),
      getStorageWarnings: jest.fn().mockResolvedValue([]),
      ...overrides,
    },
  }
}

const hotkeyStatus = {
  enabled: true,
  registered: ['F13'],
  failures: [
    { accelerator: 'CmdOrCtrl+Shift+S', owner: 'Stop Scene', reason: 'in use by another app' },
  ],
}

describe('readLogTail', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hibiki-diagnostics-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns the last lines of the log file', async () => {
    const file = path.join(dir, 'hibiki.log')
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i + 1}`)
    fs.writeFileSync(file, `${lines.join('\n')}\n`)

    const tail = await readLogTail(file, LOG_TAIL_LINES)

    expect(LOG_TAIL_LINES).toBe(300)
    expect(tail).toHaveLength(300)
    expect(tail[0]).toBe('line 101')
    expect(tail.at(-1)).toBe('line 400')
  })

  it('returns every line of a short log', async () => {
    const file = path.join(dir, 'hibiki.log')
    fs.writeFileSync(file, 'a\r\nb\r\n')

    await expect(readLogTail(file, 300)).resolves.toEqual(['a', 'b'])
  })

  it('returns null when the log cannot be read', async () => {
    await expect(readLogTail(path.join(dir, 'missing.log'), 300)).resolves.toBeNull()
  })
})

describe('buildDiagnosticsSummary', () => {
  function build(overrides: Record<string, unknown> = {}): Promise<string> {
    return buildDiagnosticsSummary({
      environment,
      api: fakeApi(),
      hotkeyStatus,
      secretStorageAvailable: true,
      loadLogTail: async () => ['2026-10-30T10:00:00.000Z [info ] [app] hello'],
      homeDir: '/home/gm',
      ...overrides,
    })
  }

  it('lists the environment the app runs in', async () => {
    const text = await build()

    expect(text).toContain('Hibiki: 1.9.0')
    expect(text).toContain('Electron: 40.1.0')
    expect(text).toContain('Node: 24.3.0')
    expect(text).toContain('OS: win32 x64')
    expect(text).toContain('Locale: de-DE')
  })

  it('reports the active Output Target and Output Device', async () => {
    const text = await build()

    expect(text).toContain('Output Target: Local')
    expect(text).toContain('Output Device: USB Headset')
  })

  it('falls back to the system default Output Device and the Discord Target', async () => {
    const text = await build({
      api: fakeApi({
        getActiveOutputTarget: jest.fn().mockResolvedValue('discord'),
        getLocalOutputDevice: jest.fn().mockResolvedValue(null),
      }),
    })

    expect(text).toContain('Output Target: Discord')
    expect(text).toContain('Output Device: System default')
  })

  it('reports whether global Hotkeys are enabled and which keys the OS refused', async () => {
    const text = await build()

    expect(text).toContain('Global Hotkeys: enabled')
    expect(text).toContain('- CmdOrCtrl+Shift+S (Stop Scene): in use by another app')
  })

  it('says none were refused when every Hotkey registered', async () => {
    const text = await build({
      hotkeyStatus: { enabled: false, registered: [], failures: [] },
    })

    expect(text).toContain('Global Hotkeys: disabled')
    expect(text).toContain('Refused Hotkeys: none')
  })

  it('carries set / not set flags for secrets, never their values', async () => {
    const text = await build()

    expect(text).toContain('Secret storage: encrypted')
    expect(text).toContain('Discord token: set')
    expect(text).toContain('Vision Provider: openai-compatible')
    expect(text).toContain('Vision key: set')
    expect(text).toContain('Vision to Vibe: on')
    expect(text).not.toContain('localhost:11434')
  })

  it('names an environment-supplied token and unencrypted secret storage', async () => {
    const text = await build({
      secretStorageAvailable: false,
      api: fakeApi({
        getDiscord: jest.fn().mockResolvedValue({ tokenConfigured: true, encrypted: false, fromEnvironment: true }),
      }),
    })

    expect(text).toContain('Secret storage: unavailable (stored as plain text)')
    expect(text).toContain('Discord token: set (from DISCORD_TOKEN)')
  })

  it('reports Usage Stats and storage warnings, cutting the backup path to its file name', async () => {
    const text = await build({
      api: fakeApi({
        getUsageStats: jest.fn().mockResolvedValue({ enabled: true, prompted: true }),
        getStorageWarnings: jest.fn().mockResolvedValue([
          { file: '/srv/hibiki/data/scenes.json', backupPath: '/srv/hibiki/data/scenes.json.corrupt-1' },
        ]),
      }),
    })

    expect(text).toContain('Usage Stats: on')
    expect(text).toContain('- scenes.json (backup: scenes.json.corrupt-1)')
    expect(text).not.toContain('/srv/hibiki')
  })

  it('replaces the home folder with ~ everywhere, the log tail included', async () => {
    const text = await build({
      loadLogTail: async () => ['[hibiki] Storage root /home/gm/.config/hibiki/data'],
    })

    expect(text).toContain('[hibiki] Storage root ~/.config/hibiki/data')
    expect(text).not.toContain('/home/gm')
  })

  it('says so when there are no storage warnings', async () => {
    expect(await build()).toContain('Storage warnings: none')
  })

  it('ends with the log tail', async () => {
    const text = await build()

    expect(text.trimEnd().endsWith('2026-10-30T10:00:00.000Z [info ] [app] hello')).toBe(true)
  })

  it('notes an unreadable log instead of failing', async () => {
    const text = await build({
      loadLogTail: async () => null,
    })

    expect(text).toContain('(log file could not be read)')
  })

  it('keeps going when a settings reader fails', async () => {
    const text = await build({
      api: fakeApi({
        getVision: jest.fn().mockRejectedValue(new Error('boom')),
      }),
      hotkeyStatus: null,
    })

    expect(text).toContain('Vision Provider: unknown')
    expect(text).toContain('Vision key: unknown')
    expect(text).toContain('Global Hotkeys: unknown')
    expect(text).toContain('Discord token: set')
  })
})
