const fs = require('node:fs')
const path = require('node:path')

const LOG_FILE_NAME = 'hibiki.log'
const ROTATED_FILE_NAME = 'hibiki.old.log'
const MAX_LOG_BYTES = 5 * 1024 * 1024
const LEVELS = ['log', 'info', 'warn', 'error', 'debug']

function formatArg(arg) {
  if (arg instanceof Error)
    return arg.stack || `${arg.name}: ${arg.message}`
  if (typeof arg === 'string')
    return arg
  try {
    return JSON.stringify(arg)
  }
  catch {
    return String(arg)
  }
}

/**
 * Mirrors every `console.*` call from the main process into
 * `<logsDir>/hibiki.log`, since a packaged app (Windows above all) has no
 * console anyone can read. Appends are synchronous so the last lines before a
 * crash still make it to disk. One rotation to `hibiki.old.log` once the
 * file passes `MAX_LOG_BYTES`.
 */
function setupFileLogging(logsDir, header) {
  try {
    fs.mkdirSync(logsDir, { recursive: true })
  }
  catch {
    // Unwritable location: the console mirror still runs, the appends below just fail quietly.
  }
  const logFile = path.join(logsDir, LOG_FILE_NAME)
  const rotatedFile = path.join(logsDir, ROTATED_FILE_NAME)

  const rotateIfLarge = () => {
    try {
      if (fs.statSync(logFile).size > MAX_LOG_BYTES)
        fs.renameSync(logFile, rotatedFile)
    }
    catch {
      // Missing file on first launch, or a rename race: either way nothing to rotate.
    }
  }

  const append = (level, args) => {
    const line = `${new Date().toISOString()} [${level.padEnd(5)}] ${args.map(formatArg).join(' ')}\n`
    try {
      fs.appendFileSync(logFile, line)
    }
    catch {
      // Logging must never take the app down with it.
    }
  }

  rotateIfLarge()
  for (const level of LEVELS) {
    // eslint-disable-next-line no-console
    const original = console[level].bind(console)
    // eslint-disable-next-line no-console
    console[level] = (...args) => {
      original(...args)
      append(level, args)
    }
  }

  append('info', ['----------------------------------------'])
  append('info', [header])

  process.on('unhandledRejection', (reason) => {
    append('error', ['Unhandled promise rejection:', reason])
  })

  return { logFile, logsDir }
}

/** Tagged logger for main-process code, mirroring `src/logger.ts`; every level reaches the log file through the console mirror above. */
function createLogger(tag) {
  const prefix = `[${tag}]`
  return {
    // eslint-disable-next-line no-console
    debug: (...args) => console.debug(prefix, ...args),
    // eslint-disable-next-line no-console
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  }
}

module.exports = { setupFileLogging, createLogger }
