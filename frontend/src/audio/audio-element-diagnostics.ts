/**
 * Renderer-side visibility for local preview and the chunked-IPC fallback.
 * The main process captures these console lines into hibiki.log, and nothing
 * else on the `<audio>` path leaves a trace: a request to hibiki:// that
 * never answers makes the element sit in `networkState` LOADING forever
 * without ever firing `error`.
 */

const WATCHED = new WeakSet<HTMLAudioElement>()
const LOAD_WARNING_MS = 5_000

/** Tagged info line for the renderer; the main process captures info lines that start with `[` into hibiki.log. */
export function logInfo(message: string): void {
  // eslint-disable-next-line no-console
  console.info(message)
}

/** Tagged debug line for the renderer; captured into hibiki.log like `logInfo`, at debug level. */
export function logDebug(message: string): void {
  // eslint-disable-next-line no-console
  console.debug(message)
}

function describe(el: HTMLAudioElement): string {
  return `${el.src || '(no src)'} readyState=${el.readyState} networkState=${el.networkState}`
}

/** Logs the element's error, stall and abort events once per element. */
export function watchAudioElement(el: HTMLAudioElement): HTMLAudioElement {
  if (WATCHED.has(el))
    return el
  WATCHED.add(el)
  el.addEventListener('error', () => {
    const err = el.error
    console.error(`[audio] element error code=${err?.code ?? 'unknown'} ${err?.message ?? ''} ${describe(el)}`.trim())
  })
  el.addEventListener('stalled', () => console.warn(`[audio] stalled: ${describe(el)}`))
  el.addEventListener('abort', () => console.warn(`[audio] load aborted: ${describe(el)}`))
  return el
}

/**
 * Resolves once the element can play through, rejects on a media error, and
 * warns in the log if neither has happened after `LOAD_WARNING_MS`, so a
 * silently hanging load is visible instead of just "nothing happened".
 */
export function waitForPlayable(el: HTMLAudioElement, label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now()
    const timer = setTimeout(() => {
      console.warn(`[audio] ${label} still not playable after ${LOAD_WARNING_MS} ms: ${describe(el)}`)
    }, LOAD_WARNING_MS)
    const done = () => clearTimeout(timer)
    el.addEventListener('canplaythrough', () => {
      done()
      logInfo(`[audio] ${label} playable after ${Date.now() - startedAt} ms (duration ${Number.isFinite(el.duration)
        ? el.duration.toFixed(1)
        : '?'} s)`)
      resolve()
    }, { once: true })
    el.addEventListener('error', () => {
      done()
      reject(el.error ?? new Error('Audio load failed'))
    }, { once: true })
  })
}
