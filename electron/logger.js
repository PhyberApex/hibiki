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

/** Longest a single string argument may run in a log line before it is cut. */
const MAX_STRING_CHARS = 4000
/** Everything a log viewer or editor may break a line on. */
const LINE_BREAKS = /\r\n|[\n\r\u2028\u2029\u0085]/g
const ESCAPED_BREAKS = {
  '\n': '\\n',
  '\r': '\\r',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
  '\u0085': '\\u0085',
}

/**
 * A string as it may appear in a log line (#780): line breaks escaped, since
 * strings carry scene, sound and Discord channel names a downloaded package or
 * another server member controls, and a raw break would let them forge entries
 * in the one artifact every bug report ships with. Clamped so one argument
 * cannot flood the file.
 */
function formatString(text) {
  const clamped = text.length > MAX_STRING_CHARS
    ? `${text.slice(0, MAX_STRING_CHARS)}… (${text.length - MAX_STRING_CHARS} more characters)`
    : text
  return clamped.replace(LINE_BREAKS, match => [...match].map(c => ESCAPED_BREAKS[c]).join(''))
}

/**
 * An error's stack, kept multi-line for readability but with every
 * continuation line indented: an entry starts with a timestamp at column 0,
 * so an attacker-controlled message cannot pass for one.
 */
function formatError(err) {
  const text = err.stack || `${err.name}: ${err.message}`
  return text.replace(LINE_BREAKS, '\n  ')
}

function formatArg(arg) {
  if (arg instanceof Error)
    return formatError(arg)
  if (typeof arg === 'string')
    return formatString(arg)
  try {
    // JSON escapes `\n` and `\r` but not U+2028, U+2029 or U+0085. `undefined` stays undefined, which `join` prints as nothing.
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
