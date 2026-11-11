const fs = require('node:fs')
const path = require('node:path')

const LOG_FILE_NAME = 'hibiki.log'
const ROTATED_FILE_NAME = 'hibiki.old.log'
const MAX_LOG_BYTES = 5 * 1024 * 1024
const LEVELS = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
]

/** Longest a single argument may run in a log line before it is cut. */
const MAX_ARG_CHARS = 4000
/** Everything a log viewer, editor or terminal may break a line on. */
const LINE_BREAKS = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/g
/** C0 and C1 control characters but tab, and the Unicode line and paragraph separators: line breaks, plus ESC and friends a terminal acts on. */
const CONTROL_CHARS = /(?!\t)[\p{Cc}\u2028\u2029]/gu

/** `\n` and `\r` as their usual escapes, every other control character as `\uXXXX`. */
function escapeControlChar(c) {
  if (c === '\n')
    return '\\n'
  if (c === '\r')
    return '\\r'
  return `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
}

/** Clamped so one argument cannot flood the file; never cuts a surrogate pair in half. */
function clamp(text) {
  if (text.length <= MAX_ARG_CHARS)
    return text
  const end = /[\uD800-\uDBFF]/.test(text[MAX_ARG_CHARS - 1])
    ? MAX_ARG_CHARS - 1
    : MAX_ARG_CHARS
  return `${text.slice(0, end)}… (${text.length - end} more characters)`
}

/**
 * A string as it may appear in a log line (#780): control characters
 * escaped, since strings carry scene, sound and Discord channel names a
 * downloaded package or another server member controls, and a raw line break
 * (or a terminal escape) would let them forge entries in the one artifact
 * every bug report ships with.
 */
function formatString(text) {
  return clamp(text).replace(CONTROL_CHARS, escapeControlChar)
}

/**
 * An error's stack, kept multi-line for readability but with every
 * continuation line indented: an entry starts with a timestamp at column 0,
 * so an attacker-controlled message cannot pass for one.
 */
function formatError(err) {
  const text = String(err.stack || `${err.name}: ${err.message}`)
  return clamp(text)
    .replace(LINE_BREAKS, '\n  ')
    .replace(CONTROL_CHARS, c => c === '\n'
      ? c
      : escapeControlChar(c))
}

function formatArg(arg) {
  if (arg instanceof Error)
    return formatError(arg)
  if (typeof arg === 'string')
    return formatString(arg)
  try {
    // JSON escapes C0 controls but not DEL, C1 (ESC's 8-bit kin), U+2028 or U+2029. `undefined` stays undefined, which `join` prints as nothing.
    const json = JSON.stringify(arg)
    return json === undefined
      ? json
      : formatString(json)
  }
  catch {
    return formatString(String(arg))
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
  catch (err) {
    // Unwritable location: the console mirror still runs, the appends below just fail quietly.
    console.warn(`Could not create the log folder ${logsDir}; logging to the console only:`, err)
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
    try {
      const line = `${new Date().toISOString()} [${level.padEnd(5)}] ${args.map(formatArg).join(' ')}\n`
      fs.appendFileSync(logFile, line)
    }
    catch {
      // Logging must never take the app down with it, whether formatting an odd value or writing fails.
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
