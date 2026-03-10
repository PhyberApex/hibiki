/**
 * Thin logging facade that tags output with a module prefix.
 *
 * All levels route through console.warn / console.error so the
 * no-console lint rule (which allows only warn and error) is satisfied.
 */
export function createLogger(tag: string) {
  const prefix = `[${tag}]`
  return {
    info: (...args: unknown[]) => console.warn(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, '⚠', ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  }
}
