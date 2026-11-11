/**
 * Longest favicon URL forwarded to the renderer (#785). Mirrors
 * `MAX_FAVICON_URL_LENGTH` and `isSafeFaviconUrl` in `src/config/bookmarks.ts`,
 * which main cannot require before the backend is built; keep them in step.
 */
const MAX_FAVICON_URL_LENGTH = 16 * 1024

/**
 * Whether a Browser tab's favicon URL may be shown in the app's own origin:
 * `https:` or an inline `data:image/*`, no longer than `MAX_FAVICON_URL_LENGTH`.
 * The page picks the URL; anything else would let it make the app fetch an
 * arbitrary URL, or bloat `app-config.json` once bookmarked.
 */
function isSafeFaviconUrl(value) {
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

/** The first favicon in Electron's `page-favicon-updated` list that `isSafeFaviconUrl` accepts, or null. */
function pickFavicon(favicons) {
  if (!Array.isArray(favicons))
    return null
  return favicons.find(isSafeFaviconUrl) ?? null
}

module.exports = { isSafeFaviconUrl, MAX_FAVICON_URL_LENGTH, pickFavicon }
