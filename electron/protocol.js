const fs = require('node:fs')
const path = require('node:path')

/**
 * What a `Range` request header asks of a file of `totalSize` bytes:
 * - `{ kind: 'full' }` when there is no header or it is not a `bytes=<start>-[<end>]` range,
 * - `{ kind: 'partial', start, end }` with `end` clamped to the last byte, so
 *   the advertised `Content-Length` matches what the file stream delivers,
 * - `{ kind: 'unsatisfiable' }` when the range starts past the end of the file
 *   or after its own end (every range on a zero-byte file), answered with 416.
 */
function parseRange(rangeHeader, totalSize) {
  const match = rangeHeader?.match(/bytes=(\d+)-(\d*)/)
  if (!match)
    return { kind: 'full' }
  const start = Number.parseInt(match[1], 10)
  const end = Math.min(
    match[2]
      ? Number.parseInt(match[2], 10)
      : totalSize - 1,
    totalSize - 1,
  )
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= totalSize || start > end)
    return { kind: 'unsatisfiable' }
  return { kind: 'partial', start, end }
}

/**
 * The file under `webDistDir` that serves `hibiki://app<pathname>`, or `null`
 * when the pathname is malformed or escapes `webDistDir`. Chromium already
 * resolves `..` segments when it canonicalises the URL, but decoding can turn
 * `..%2F` into a real one, so containment is re-checked after decoding.
 * Anything that is not a regular file (an unknown route, a directory such as
 * `/assets`) falls back to `index.html` for the SPA router.
 */
function resolveAppPath(webDistDir, pathname) {
  const indexPath = path.join(webDistDir, 'index.html')
  let decoded
  try {
    decoded = decodeURIComponent(pathname || '/')
  }
  catch {
    return null
  }
  if (decoded.includes('\0'))
    return null
  const root = path.resolve(webDistDir)
  const filePath = path.join(root, decoded)
  if (filePath !== root && !filePath.startsWith(root + path.sep))
    return null
  return fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()
    ? filePath
    : indexPath
}

module.exports = { parseRange, resolveAppPath }
