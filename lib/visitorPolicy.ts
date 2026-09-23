import { firstNameOf } from '@/lib/data'
import { shiftDay } from '@/lib/cityTime'

// ── Visitor announcements: the rules, client-safe ───────────────────────────
//
// What a visit may say (dates), what a guest of the public page is shown of
// one, and what goes into the push to locals. Shared by the API, the page
// and the form so the three can't drift.

// A visit is a trip, not a residency: the list sorts by arrival and "here
// now" leads it, so an open-ended card would sit at the top for years.
export const MAX_VISIT_DAYS = 90
// And it is a plan, not a wish: a year out is as far as the calendar goes.
export const MAX_LEAD_DAYS  = 365

/** 'YYYY-MM-DD' that exists on the calendar (2026-02-31 does not). */
export function isRealDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/** Why these dates can't be a visit, or null. `today` is the destination city's calendar day. */
export function visitDatesError(startsOn: unknown, endsOn: unknown, today: string): string | null {
  if (!isRealDate(startsOn) || !isRealDate(endsOn)) return 'Dates must be real calendar days (YYYY-MM-DD)'
  if (endsOn < startsOn) return 'The end date must be on or after the start date'
  if (endsOn < today) return 'Trip ends in the past'
  if (daysBetween(startsOn, endsOn) > MAX_VISIT_DAYS) return `A visit can be at most ${MAX_VISIT_DAYS} days — for a longer stay, post the first part and update it later`
  if (daysBetween(today, startsOn) > MAX_LEAD_DAYS) return `Visits can be posted up to a year ahead`
  return null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.trim().slice(0, 200)
  return EMAIL_RE.test(e) ? e : null
}

/** First and last day of the month `d` falls in. */
export function monthBounds(d: string): { start: string; end: string } {
  const start = `${d.slice(0, 7)}-01`
  return { start, end: shiftDay(shiftDay(`${d.slice(0, 7)}-28`, 4).slice(0, 7) + '-01', -1) }
}

export interface GuestVisit {
  name:        string
  startsOn:    string
  endsOn:      string
  approximate: true
}

/**
 * What a logged-out reader is shown of a public card: a first name and the
 * month(s), never the exact dates or the neighbourhood. Paired with the
 * member's home neighbourhood from /neighborhoods, exact dates would say
 * whose home is empty when — the one thing this page must not publish.
 */
export function guestView(a: { name: string; startsOn: string; endsOn: string }): GuestVisit {
  return { name: firstNameOf(a.name), startsOn: monthBounds(a.startsOn).start, endsOn: monthBounds(a.endsOn).end, approximate: true }
}

/**
 * The name a visitor's card carries, to anyone.
 *
 * The field is free text, but the form prefilled it with the poster's full
 * account name for months, so redacting the AUTHOR never removed the surname —
 * it arrived by the other field. Guests were always cut (guestView); members
 * were not, and the same card read "Maria" on /visiting and "Maria Gonzalez"
 * on the city hub. Every surface goes through this now, and old rows are cut
 * on read rather than needing a migration.
 */
export function visitorName(name: string): string {
  return firstNameOf(name) || name
}

/** Free text bound for a push body: one line, no links, short. */
export function notifyText(v: unknown, max = 40): string {
  if (typeof v !== 'string') return ''
  return v.replace(/https?:\/\/\S+|www\.\S+/gi, '').replace(/\s+/g, ' ').trim().slice(0, max)
}
