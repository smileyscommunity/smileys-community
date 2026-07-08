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

/**
 * Normalize an admin-supplied payment contact into a canonical wa.me link.
 *
 * Accepts:
 *   - a phone number ("+90 555 123 4567", "0555 123 45 67", "905551234567")
 *   - a wa.me / api.whatsapp.com link
 *   - empty / null → null (clears the field)
 *
 * Returns the normalized `https://wa.me/<digits>` string, null when
 * clearing, or an Error describing why the input was rejected.
 */
export function normalizePaymentContact(v: unknown): string | null | Error {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string') return new Error('paymentContact must be a string')
  const s = v.trim()
  const fromLink = s.match(/^https:\/\/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=)(\+?\d[\d]*)/i)
  const raw = fromLink ? fromLink[1] : s
  const digits = raw.replace(/[\s\-().+]/g, '')
  if (!/^\d{7,15}$/.test(digits)) {
    return new Error('paymentContact must be a phone number or wa.me link')
  }
  return `https://wa.me/${digits}`
}
