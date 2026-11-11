/** Longest piece of untrusted text quoted in a native dialog. */
export const DIALOG_TEXT_MAX_LENGTH = 60

/**
 * `text` made safe to quote inside a native `confirm()` (#785): one line, no
 * control or bidi-override characters, at most `max` characters with an
 * ellipsis. A Scene name can come from a downloaded package, and newlines in
 * it would otherwise let that package write most of the prompt the GM reads.
 */
export function dialogSafeText(text: string, max = DIALOG_TEXT_MAX_LENGTH): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const oneLine = text.replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = [...oneLine]
  return chars.length > max
    ? `${chars.slice(0, max - 1).join('').trimEnd()}…`
    : oneLine
}
