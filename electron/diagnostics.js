const fs = require('node:fs')
const path = require('node:path')

/** How much of `hibiki.log` the Diagnostics summary carries. */
const LOG_TAIL_LINES = 300

/** The last `maxLines` lines of `file`; rejects when it cannot be read. The log rotates at 5 MB, so reading it whole is fine. */
async function readLogTail(file, maxLines) {
  const raw = await fs.promises.readFile(file, 'utf-8')
  const lines = raw.split(/\r?\n/)
  if (lines.at(-1) === '')
    lines.pop()
  return lines.slice(-maxLines)
}

/** Resolves to `fallback` instead of rejecting, so one broken reader cannot cost the GM the whole summary; the failure is still logged. */
async function settle(label, read, fallback, log) {
  try {
    return await read()
  }
  catch (err) {
    log?.warn(`Diagnostics summary: could not read ${label}:`, err)
    return fallback
  }
}

function setFlag(isSet) {
  if (isSet === undefined)
    return 'unknown'
  return isSet ? 'set' : 'not set'
}

function onOff(enabled) {
  if (enabled === undefined)
    return 'unknown'
  return enabled ? 'on' : 'off'
}

function describeTarget(kind) {
  if (kind === 'local')
    return 'Local'
  if (kind === 'discord')
    return 'Discord'
  return 'unknown'
}

function describeDevice(device) {
  if (device === undefined)
    return 'unknown'
  if (device === null)
    return 'System default'
  return device.label || '(unnamed device)'
}

function describeToken(discord) {
  if (!discord)
    return 'unknown'
  if (!discord.tokenConfigured)
    return 'not set'
  return discord.fromEnvironment ? 'set (from DISCORD_TOKEN)' : 'set'
}

function describeVisionKey(vision) {
  if (!vision)
    return 'unknown'
  const provider = vision.provider === 'openai-compatible'
    ? vision.openaiCompatible
    : vision.claude
  return setFlag(provider?.keyConfigured)
}

function describeHotkeysEnabled(status) {
  if (!status)
    return 'unknown'
  return status.enabled ? 'enabled' : 'disabled'
}

/** Replaces every occurrence of the home folder with `~`: a path under it carries the OS user name. */
function redactHomeDir(text, homeDir) {
  if (!homeDir || homeDir.length < 2)
    return text
  return text.split(homeDir).join('~')
}

/**
 * Shapes of the secrets Hibiki handles, should one ever reach the log: a
 * Discord bot token (three base64url parts joined by dots), an Anthropic key
 * (`sk-ant-…`) and an OpenAI-style key (`sk-…`, `sk-proj-…`). The `sk-`
 * shapes take no word boundary: the logger writes a newline as a literal `\n`,
 * so a key logged right after one follows the letter `n`. Redacting a
 * lookalike id is the cheaper mistake.
 */
const SECRET_PATTERNS = [
  /(?<![\w-])[\w-]{23,}\.[\w-]{6,7}\.[\w-]{27,}(?![\w-])/g,
  /sk-ant-[\w-]+/g,
  /sk-[\w-]{20,}/g,
]
const REDACTED = '[redacted]'

/** `lines` with every secret-shaped string replaced, and how many were. */
function redactSecrets(lines) {
  let count = 0
  const redacted = lines.map(line => SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, () => {
    count++
    return REDACTED
  }), line))
  return { lines: redacted, count }
}

/**
 * The plain-text block Settings → Diagnostics copies for a bug report (#698).
 * Secrets are excluded by construction: it reads only the same status readers
 * Settings uses, which report "set / not set", never a value. Storage warnings
 * name only the file, and the home folder is replaced with `~` everywhere
 * (log tail included), since a full path carries the OS user name. The log
 * tail, the one part not secret-free by construction, also loses anything
 * shaped like a Discord token or an API key (#780).
 */
async function buildDiagnosticsSummary({ environment, api, hotkeyStatus, secretStorageAvailable, loadLogTail, homeDir, log }) {
  const config = api.config
  const [target, device, discord, vision, usageStats, storageWarnings, logTail] = await Promise.all([
    settle('Output Target', () => config.getActiveOutputTarget(), undefined, log),
    settle('Output Device', () => config.getLocalOutputDevice(), undefined, log),
    settle('Discord settings', () => config.getDiscord(), null, log),
    settle('Vision settings', () => config.getVision(), null, log),
    settle('Usage Stats settings', () => config.getUsageStats(), null, log),
    settle('storage warnings', () => config.getStorageWarnings(), null, log),
    settle('the log tail', () => loadLogTail(), null, log),
  ])

  const lines = [
    'Hibiki diagnostics',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Environment',
    `Hibiki: ${environment.appVersion}`,
    `Electron: ${environment.electronVersion}`,
    `Node: ${environment.nodeVersion}`,
    `OS: ${environment.platform} ${environment.arch}`,
    `Locale: ${environment.locale}`,
    '',
    '## Audio',
    `Output Target: ${describeTarget(target)}`,
    `Output Device: ${describeDevice(device)}`,
    '',
    '## Hotkeys',
    `Global Hotkeys: ${describeHotkeysEnabled(hotkeyStatus)}`,
  ]
  if (!hotkeyStatus)
    lines.push('Refused Hotkeys: unknown')
  else if (hotkeyStatus.failures.length === 0)
    lines.push('Refused Hotkeys: none')
  else
    lines.push('Refused Hotkeys:', ...hotkeyStatus.failures.map(f => `- ${f.accelerator} (${f.owner}): ${f.reason}`))

  lines.push(
    '',
    '## Settings',
    `Secret storage: ${secretStorageAvailable ? 'encrypted' : 'unavailable (stored as plain text)'}`,
    `Discord token: ${describeToken(discord)}`,
    `Vision Provider: ${vision?.provider ?? 'unknown'}`,
    `Vision key: ${describeVisionKey(vision)}`,
    `Vision to Vibe: ${onOff(vision?.enabled)}`,
    `Usage Stats: ${onOff(usageStats?.enabled)}`,
  )
  if (!storageWarnings)
    lines.push('Storage warnings: unknown')
  else if (storageWarnings.length === 0)
    lines.push('Storage warnings: none')
  else
    lines.push('Storage warnings:', ...storageWarnings.map(w => `- ${path.basename(w.file)} (backup: ${path.basename(w.backupPath)})`))

  lines.push('', `## Log (last ${LOG_TAIL_LINES} lines of hibiki.log)`)
  if (logTail) {
    // The tail is the one part not secret-free by construction: it holds whatever any code ever logged (#780).
    const redaction = redactSecrets(logTail)
    if (redaction.count > 0)
      log?.warn(`Diagnostics summary: redacted ${redaction.count} secret-shaped string(s) from the log tail`)
    lines.push(...redaction.lines)
  }
  else {
    lines.push('(log file could not be read)')
  }

  return redactHomeDir(`${lines.join('\n')}\n`, homeDir)
}

module.exports = { buildDiagnosticsSummary, readLogTail, LOG_TAIL_LINES }
