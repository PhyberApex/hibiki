/* eslint-disable no-console */

export interface Logger {
  /** Chatty detail (per-chunk, per-tick, hot paths). Still lands in the log file, so keep it to things worth reading after a bug report. */
  debug: (...args: unknown[]) => void
  /** State changes and user-triggered actions: joins, plays, stops, config writes. */
  info: (...args: unknown[]) => void
  /** Something degraded but handled. */
  warn: (...args: unknown[]) => void
  /** Something failed. */
  error: (...args: unknown[]) => void
}

/**
 * Tags every line with a `[module]` prefix and routes it to the console
 * method of the same level. The main process mirrors every console method
 * into `<userData>/logs/hibiki.log` (see `electron/logger.js`), so these
 * lines are what a bug report from a packaged build comes with. Never log
 * secrets (tokens, API keys) or user media contents.
 */
export function createLogger(tag: string): Logger {
  const prefix = `[${tag}]`
  return {
    debug: (...args) => console.debug(prefix, ...args),
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  }
}
