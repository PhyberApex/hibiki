/**
 * Renderer-side visibility for local preview and the chunked-IPC fallback.
 * The main process captures these console lines into hibiki.log, and nothing
 * else on the `<audio>` path leaves a trace: a request to hibiki:// that
 * never answers makes the element sit in `networkState` LOADING forever
 * without ever firing `error`.
 */

const WATCHED = new WeakSet<HTMLAudioElement>()
const LOAD_WARNING_MS = 5_000
const LOAD_TIMEOUT_MS = 30_000

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
 * silently hanging load is visible instead of just "nothing happened". After
 * `LOAD_TIMEOUT_MS` it gives up and rejects: a load that never answers must
 * fail the start it belongs to, not hold up a Scene start (and with it every
 * queued Hotkey) for the rest of the session (#714).
 */
export function waitForPlayable(el: HTMLAudioElement, label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now()
    const timer = setTimeout(() => {
      console.warn(`[audio] ${label} still not playable after ${LOAD_WARNING_MS} ms: ${describe(el)}`)
    }, LOAD_WARNING_MS)
    const timeout = setTimeout(() => {
      cleanup()
      console.error(`[audio] ${label} not playable after ${LOAD_TIMEOUT_MS} ms, giving up: ${describe(el)}`)
      reject(new Error(`${label} not playable after ${LOAD_TIMEOUT_MS} ms`))
    }, LOAD_TIMEOUT_MS)
    // The element is reused across plays, so whichever listener did not fire
    // must go too, or it reports on a later, unrelated load.
    function cleanup() {
      clearTimeout(timer)
      clearTimeout(timeout)
      el.removeEventListener('canplaythrough', onPlayable)
      el.removeEventListener('error', onError)
    }
    function onPlayable() {
      cleanup()
      logInfo(`[audio] ${label} playable after ${Date.now() - startedAt} ms (duration ${Number.isFinite(el.duration)
        ? el.duration.toFixed(1)
        : '?'} s)`)
      resolve()
    }
    function onError() {
      cleanup()
      reject(el.error ?? new Error('Audio load failed'))
    }
    el.addEventListener('canplaythrough', onPlayable)
    el.addEventListener('error', onError)
  })
}
