import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createLogger, setupFileLogging } from './logger'

const LEVELS = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
] as const
const MAX_LOG_BYTES = 5 * 1024 * 1024

describe('setupFileLogging', () => {
  let dir: string
  let originals: Record<string, (...args: unknown[]) => void>
  let rejectionListeners: ((...args: unknown[]) => void)[]

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hibiki-logger-'))
    // Silence the terminal: setupFileLogging wraps whatever console[level] is at call time.
    originals = {}
    for (const level of LEVELS) {
      // eslint-disable-next-line no-console
      originals[level] = console[level]
      // eslint-disable-next-line no-console
      console[level] = jest.fn()
    }
    rejectionListeners = process.listeners('unhandledRejection')
  })

  afterEach(() => {
    for (const level of LEVELS)
      // eslint-disable-next-line no-console
      console[level] = originals[level]
    for (const listener of process.listeners('unhandledRejection')) {
      if (!rejectionListeners.includes(listener))
        process.off('unhandledRejection', listener)
    }
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const readLog = () => fs.readFileSync(path.join(dir, 'hibiki.log'), 'utf8')

  it('writes the header and mirrors every console level with a timestamp', () => {
    const silenced = { ...console }
    const { logFile, logsDir } = setupFileLogging(dir, 'Hibiki 1.0.0 starting')

    // eslint-disable-next-line no-console
    console.info('[ipc]', 'joined', { guildId: 'g1' })
    console.warn(new Error('degraded'))
    // eslint-disable-next-line no-console
    console.debug('tick')

    expect(logFile).toBe(path.join(dir, 'hibiki.log'))
    expect(logsDir).toBe(dir)
    const lines = readLog().trimEnd().split('\n')
    expect(lines[1]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z \[info \] Hibiki 1\.0\.0 starting$/)
    expect(lines[2]).toMatch(/Z \[info \] \[ipc\] joined \{"guildId":"g1"\}$/)
    expect(lines[3]).toMatch(/Z \[warn \] Error: degraded$/)
    expect(readLog()).toMatch(/Z \[debug\] tick\n$/)
    expect(silenced.info).toHaveBeenCalledWith('[ipc]', 'joined', { guildId: 'g1' })
  })

  it('falls back to String() for values JSON cannot serialise', () => {
    setupFileLogging(dir, 'start')
    const circular: Record<string, unknown> = {}
    circular.self = circular

    console.error('cycle', circular, 10n)

    expect(readLog()).toMatch(/\[error\] cycle \[object Object\] 10\n$/)
  })

  it('logs unhandled rejections', () => {
    setupFileLogging(dir, 'start')
    const listener = process.listeners('unhandledRejection').find(l => !rejectionListeners.includes(l))!

    listener(new Error('lost'), Promise.resolve())

    expect(readLog()).toContain('[error] Unhandled promise rejection: Error: lost')
  })

  it('rotates a log past 5 MB to hibiki.old.log', () => {
    fs.writeFileSync(path.join(dir, 'hibiki.log'), Buffer.alloc(MAX_LOG_BYTES + 1, 'x'))

    setupFileLogging(dir, 'fresh start')

    expect(fs.statSync(path.join(dir, 'hibiki.old.log')).size).toBe(MAX_LOG_BYTES + 1)
    expect(readLog()).not.toContain('xxx')
    expect(readLog()).toContain('fresh start')
  })

  it('leaves a log at or under 5 MB in place', () => {
    fs.writeFileSync(path.join(dir, 'hibiki.log'), 'earlier session\n')

    setupFileLogging(dir, 'start')

    expect(fs.existsSync(path.join(dir, 'hibiki.old.log'))).toBe(false)
    expect(readLog()).toMatch(/^earlier session\n/)
  })

  it('never throws when the log directory cannot be created or written', () => {
    const blocker = path.join(dir, 'not-a-dir')
    fs.writeFileSync(blocker, '')
    const logsDir = path.join(blocker, 'logs')
    const silenced = { ...console }

    expect(() => setupFileLogging(logsDir, 'start')).not.toThrow()
    expect(silenced.warn).toHaveBeenCalledWith(expect.stringContaining('Could not create the log folder'), expect.objectContaining({ code: 'ENOTDIR' }))
    expect(() => console.error('still reaches the console')).not.toThrow()
    expect(silenced.error).toHaveBeenCalledWith('still reaches the console')
  })
})

describe('createLogger', () => {
  afterEach(() => jest.restoreAllMocks())

  it.each(['debug', 'info', 'warn', 'error'] as const)('routes %s to the console method of the same level with the tag', (level) => {
    const spy = jest.spyOn(console, level).mockImplementation(() => {})

    createLogger('window')[level]('created', 1)

    expect(spy).toHaveBeenCalledWith('[window]', 'created', 1)
  })
})
