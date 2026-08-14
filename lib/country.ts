// Countries are stored as ISO 3166-1 alpha-2 codes ('TR', 'PT', 'GR') and
// displayed as names ('Turkey', 'Portugal', 'Greece').
//
// Why bother: `country` on City was free text with a "Portugal" placeholder,
// so Istanbul was entered as 'TR' and Izmir as 'TURKEY' — two spellings of one
// country, rendered side by side on the homepage city cards. Storing a code
// makes the value canonical and comparable; deriving the name at render time
// means no lookup table to maintain and every locale gets it right for free.

// Intl.DisplayNames ships with Node and every browser we support. `fallback:
// 'code'` means an unrecognised value comes back unchanged rather than throwing
// — so a legacy row that never got normalised still renders something.
let display: Intl.DisplayNames | null = null

export function countryName(code: string | null | undefined): string {
  if (!code) return ''
  const trimmed = code.trim()
  if (trimmed.length !== 2) return trimmed   // legacy full-name rows pass through
  try {
    display ??= new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' })
    return display.of(trimmed.toUpperCase()) ?? trimmed
  } catch {
    return trimmed
  }
}

/**
 * Normalise admin input to a storable code, or null if it isn't one.
 * Accepts 'tr' / 'TR ' and rejects 'Turkey' — the caller turns that into an
 * error message rather than silently storing a second spelling.
 */
export function toCountryCode(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const v = input.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(v)) return null
  // Round-trips through Intl to reject well-formed non-countries. Two distinct
  // rejections: 'QQ' is unassigned so fallback:'code' hands it straight back,
  // while 'ZZ' is the reserved "unknown region" code and resolves to a real
  // string — hence both checks.
  try {
    const d = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'code' })
    const name = d.of(v)
    if (!name || name === v || /unknown/i.test(name)) return null
    return v
  } catch {
    return v   // no ICU data — accept the shape and move on
  }
}
