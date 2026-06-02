/**
 * Validate that a user-supplied URL is safe to render as `<a href={...}>`
 * or `<img src={...}>` without enabling `javascript:`/`data:`-based XSS.
 *
 * Allowed:
 *   - `https://...`   external links (most common — sponsor websites, etc.)
 *   - `mailto:...`    contact links
 *   - `/path`         relative paths within the app
 *
 * Rejected:
 *   - `javascript:`, `data:`, `vbscript:`, `file:`, etc.
 *   - Anything containing leading whitespace or control chars that some
 *     parsers tolerate but enable scheme-spoofing (e.g. ` javascript:`).
 *
 * Returns true if the URL is safe.
 */
export function isSafeHref(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false
  // Reject control chars and any whitespace anywhere — browsers tolerate
  // them but they enable scheme-spoofing tricks like "\tjavascript:".
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f\s]/.test(url)) return false
  // Relative paths (in-app links). Reject `//` which is protocol-relative.
  if (url.startsWith('/') && !url.startsWith('//')) return true
  // Absolute URLs — restrict scheme allowlist.
  return /^https:\/\//i.test(url) || /^mailto:/i.test(url)
}
