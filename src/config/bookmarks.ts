import { createLogger } from '../logger'

const log = createLogger('config')

export interface Bookmark {
  name: string
  url: string
  favicon?: string
}

/**
 * Longest favicon URL a bookmark keeps. A remote icon URL is far shorter; a
 * `data:` icon of a 32 px PNG is a few KB. Anything longer is not an icon a
 * GM needs, and would only bloat `app-config.json` (#785).
 */
export const MAX_FAVICON_URL_LENGTH = 16 * 1024

/**
 * Whether a favicon URL may be stored and shown: `https:` or an inline
 * `data:image/*`, no longer than `MAX_FAVICON_URL_LENGTH` (#785). The URL comes
 * from whatever page a Browser tab shows and is rendered as an `<img>` in the
 * app's own origin on every launch, so anything else (another scheme, a
 * `hibiki://` URL) is dropped. Plain `http:` is dropped too: the app's
 * Content-Security-Policy would refuse to load it anyway.
 * Mirrors `isSafeFaviconUrl` in `electron/favicon.js`; keep them in step.
 */
export function isSafeFaviconUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_FAVICON_URL_LENGTH)
    return false
  if (/^data:image\/[\w.+-]+[;,]/i.test(value))
    return true
  try {
    return new URL(value).protocol === 'https:'
  }
  catch {
    return false
  }
}

/** The bookmarks in `raw` that have a string name and URL, each keeping its favicon only when `isSafeFaviconUrl` accepts it. */
export function normalizeBookmarks(raw: unknown): Bookmark[] {
  if (!Array.isArray(raw))
    return []
  const bookmarks: Bookmark[] = []
  let droppedFavicons = 0
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null)
      continue
    const { name, url, favicon } = entry as Record<string, unknown>
    if (typeof name !== 'string' || typeof url !== 'string')
      continue
    if (isSafeFaviconUrl(favicon)) {
      bookmarks.push({ name, url, favicon })
      continue
    }
    if (favicon !== undefined && favicon !== null)
      droppedFavicons++
    bookmarks.push({ name, url })
  }
  if (droppedFavicons > 0)
    log.warn(`Dropped ${droppedFavicons} bookmark favicon(s): not an https or data:image URL of at most ${MAX_FAVICON_URL_LENGTH} characters`)
  return bookmarks
}

/** The stored `bookmarks` value: none when it is missing or not JSON. */
export function parseBookmarks(raw: string | null): Bookmark[] {
  if (!raw)
    return []
  try {
    return normalizeBookmarks(JSON.parse(raw))
  }
  catch {
    return []
  }
}
