import { normalizeInstagramHandle } from '@/lib/directory-constants'

// The forms of an applicant's identity that the blacklist, the cooldowns and
// the duplicate checks compare. Every lookup was an exact match on what was
// typed, so a banned member got back in with "+90 555 123 45 67" instead of
// "+905551234567", or "ali.veli+2@gmail.com" instead of "aliveli@gmail.com".

/** Digits only, a leading 00 read as +. "+90 (555) 123-45-67" → "905551234567". */
export function canonicalPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '').replace(/^00/, '')
  return digits.length >= 6 ? digits : null
}

/** Lower-cased; a +tag dropped everywhere; Gmail's dots ignored, googlemail folded in. */
export function canonicalEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  const e = raw.trim().toLowerCase()
  const at = e.lastIndexOf('@')
  if (at < 1) return null
  let local = e.slice(0, at).split('+')[0]
  let domain = e.slice(at + 1)
  if (domain === 'googlemail.com') domain = 'gmail.com'
  if (domain === 'gmail.com') local = local.replace(/\./g, '')
  return local ? `${local}@${domain}` : null
}

export function canonicalInstagram(raw: string | null | undefined): string | null {
  return normalizeInstagramHandle(raw)?.toLowerCase() ?? null
}

/** An IANA zone the runtime knows — the browser's timezone arrives as free text. */
export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz || tz.length > 60) return false
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true } catch { return false }
}

/** Whole years between a YYYY-MM-DD birthdate and `on` (UTC); null when unparseable. */
export function ageOn(birthdate: string | null | undefined, on: Date = new Date()): number | null {
  const m = birthdate?.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  let age = on.getUTCFullYear() - y
  if (on.getUTCMonth() + 1 < mo || (on.getUTCMonth() + 1 === mo && on.getUTCDate() < d)) age--
  return age
}
