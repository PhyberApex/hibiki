const { createLogger } = require('./logger')

const browserLog = createLogger('browser')

/**
 * The most Browser tabs main keeps open at once (#783). Each tab is a
 * `WebContentsView`, so its own renderer process: without a ceiling a buggy or
 * compromised renderer could open them until the machine thrashes. A GM juggles
 * a handful at most, Routed Tabs included.
 */
const MAX_BROWSER_TABS = 12

/** Throws, after logging the refusal, when `openCount` tabs already fill the ceiling. */
function assertTabCapacity(openCount) {
  if (openCount < MAX_BROWSER_TABS)
    return
  browserLog.warn(`Refused to open a tab: ${openCount} tab(s) already open (limit ${MAX_BROWSER_TABS})`)
  throw new Error(`Hibiki keeps at most ${MAX_BROWSER_TABS} Browser tabs open; close one first`)
}

module.exports = { assertTabCapacity, MAX_BROWSER_TABS }
