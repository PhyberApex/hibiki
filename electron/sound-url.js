// Mirrors SOUND_CATEGORIES and isSafeSoundId in src/sound/sound-id.ts, which
// main cannot require before the backend is built; keep them in step.
const SOUND_TYPES = ['music', 'effects', 'ambience']

/**
 * The only origin allowed to read `hibiki://sound` responses: the app's own
 * renderer. A page in a Browser tab shares the protocol, so a wildcard would
 * let it fetch whatever the handler serves (#637).
 */
const SOUND_ALLOWED_ORIGIN = 'hibiki://app'

/**
 * Parses the path of a `hibiki://sound/<type>/<id>` URL. The id must decode to
 * a single path segment; anything that could walk out of the category folder
 * (`/`, `\`, `..`) is rejected here, before the Sound Library is asked, and the
 * Sound Library re-checks on its own (#637).
 *
 * @returns {{ ok: true, type: string, id: string } | { ok: false, reason: string }} the type and decoded id, or why the URL was refused
 */
function parseSoundPath(pathname) {
  const parts = (pathname || '').split('/').filter(Boolean)
  if (parts.length !== 2)
    return { ok: false, reason: 'expected /<type>/<id>' }
  const [type, rawId] = parts
  if (!SOUND_TYPES.includes(type))
    return { ok: false, reason: `unknown type ${JSON.stringify(type)}` }
  let id
  try {
    id = decodeURIComponent(rawId)
  }
  catch {
    return { ok: false, reason: `malformed id ${JSON.stringify(rawId)}` }
  }
  if (id === '.' || id === '..' || /[/\\\0]/.test(id))
    return { ok: false, reason: `unsafe id ${JSON.stringify(id)}` }
  return { ok: true, type, id }
}

module.exports = { parseSoundPath, SOUND_ALLOWED_ORIGIN }
