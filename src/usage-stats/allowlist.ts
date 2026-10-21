/**
 * The complete set of Usage Stats events (ADR-0008, `docs/privacy.md`).
 * Nothing that is not described here ever leaves the machine: the service
 * drops any other event name, data key or value. Adding or widening an entry
 * means amending the privacy page and ADR-0008 in the same change.
 */

/**
 * How a data value is checked: one of fixed strings (`enum`), a non-negative
 * integer such as an item count (`count`), a boolean, or a string matching a
 * fixed pattern, for values that are public by nature (`pattern`: a Registry
 * entry id, the app version).
 */
export type UsageStatsValueRule
  = | { type: 'enum', values: readonly string[] }
    | { type: 'count' }
    | { type: 'boolean' }
    | { type: 'pattern', pattern: RegExp }

const TARGET: UsageStatsValueRule = { type: 'enum', values: ['discord', 'local'] }

export const USAGE_STATS_EVENTS: Readonly<Record<string, Readonly<Record<string, UsageStatsValueRule>>>> = {
  'app-start': {
    platform: { type: 'enum', values: ['darwin', 'win32', 'linux'] },
    arch: { type: 'enum', values: ['x64', 'arm64', 'ia32', 'arm'] },
    version: { type: 'pattern', pattern: /^\d+\.\d+\.\d+(?:-[\w.]+)?$/ },
    locale: { type: 'pattern', pattern: /^[a-z]{2,3}(?:-[A-Z0-9]{2,4})?$/i },
  },
  'scene-play': {
    musicMode: { type: 'enum', values: ['single', 'sequential', 'shuffle'] },
    music: { type: 'count' },
    ambience: { type: 'count' },
    effects: { type: 'count' },
    target: TARGET,
  },
  'target-switch': {
    target: TARGET,
  },
  'routed-tab-toggle': {
    routed: { type: 'boolean' },
    target: TARGET,
  },
  'hotkey-fired': {
    kind: { type: 'enum', values: ['scene', 'effect', 'action'] },
  },
  'vision-analyze': {
    provider: { type: 'enum', values: ['claude', 'openai-compatible'] },
  },
  'registry-install': {
    // The Registry's slug pattern (`registry/schema/scene-entry.schema.json`).
    entryId: { type: 'pattern', pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/ },
  },
}

/**
 * The route paths sent as Umami's `url`: the router's own patterns, so a
 * Scene id never leaves the machine (`/scenes/:id`, not `/scenes/<uuid>`).
 */
export const USAGE_STATS_URLS: readonly string[] = ['/', '/media', '/scenes', '/scenes/:id', '/browser', '/settings', '/about']

/** Sent as Umami's `hostname` with every event; the Umami website's "domain" is the same. */
export const USAGE_STATS_HOSTNAME = 'app.hibiki.phyberapex.de'

export function isAllowedValue(rule: UsageStatsValueRule, value: unknown): boolean {
  switch (rule.type) {
    case 'enum':
      return typeof value === 'string' && rule.values.includes(value)
    case 'count':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000
    case 'boolean':
      return typeof value === 'boolean'
    case 'pattern':
      return typeof value === 'string' && value.length <= 64 && rule.pattern.test(value)
  }
}
