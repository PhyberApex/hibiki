const fs = require('node:fs')
const path = require('node:path')

/** How much of `hibiki.log` the Diagnostics summary carries. */
const LOG_TAIL_LINES = 300

/** The last `maxLines` lines of `file`, or `null` when it cannot be read. The log rotates at 5 MB, so reading it whole is fine. */
async function readLogTail(file, maxLines) {
  let raw
  try {
    raw = await fs.promises.readFile(file, 'utf-8')
  }
  catch {
    return null
  }
  const lines = raw.split(/\r?\n/)
  if (lines.at(-1) === '')
    lines.pop()
  return lines.slice(-maxLines)
}

/** Resolves to `fallback` instead of rejecting, so one broken reader cannot cost the GM the whole summary. */
async function settle(read, fallback) {
  try {
    return await read()
  }
  catch {
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
 * The plain-text block Settings → Diagnostics copies for a bug report (#698).
 * Secrets are excluded by construction: it reads only the same status readers
 * Settings uses, which report "set / not set", never a value. Storage warnings
 * name only the file, and the home folder is replaced with `~` everywhere
 * (log tail included), since a full path carries the OS user name.
 */
async function buildDiagnosticsSummary({ environment, api, hotkeyStatus, secretStorageAvailable, loadLogTail, homeDir }) {
  const config = api.config
  const [target, device, discord, vision, usageStats, storageWarnings, logTail] = await Promise.all([
    settle(() => config.getActiveOutputTarget(), undefined),
    settle(() => config.getLocalOutputDevice(), undefined),
    settle(() => config.getDiscord(), null),
    settle(() => config.getVision(), null),
    settle(() => config.getUsageStats(), null),
    settle(() => config.getStorageWarnings(), null),
    settle(() => loadLogTail(), null),
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
  if (logTail)
    lines.push(...logTail)
  else
    lines.push('(log file could not be read)')

  return redactHomeDir(`${lines.join('\n')}\n`, homeDir)
}

module.exports = { buildDiagnosticsSummary, readLogTail, LOG_TAIL_LINES }
