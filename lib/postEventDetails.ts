// Structured facts for an event article (Post.eventDetails). One parser for
// both ends: scripts/set-post-event-details.ts validates with it before
// writing, and the article page runs the stored JSON through it before
// rendering, so a malformed or hand-edited row degrades to "no card" instead
// of a broken page or an unsafe href.
//
// PUBLIC facts only. A restricted offer belongs in PostMemberOffer — nothing
// in here may be a private discount link or code. Nothing is inferred: a field
// that was not supplied stays absent and the card simply omits the row.

import { isSafeHref } from './safeUrl'

export interface EventDetails {
  eventDate?:     string  // 'YYYY-MM-DD', the city's own calendar day
  startTime?:     string  // 'HH:MM' 24h
  timeConfirmed?: boolean // true only when the organizer confirmed the time
  venue?:         string
  district?:      string
  language?:      string  // performance language, when verified
  subtitles?:     string  // subtitle info, when verified
  ticketUrl?:     string  // official public ticket page, https only
  transport?:     string  // brief getting-there note
  benefit?:       string  // a PUBLIC Smileys benefit, as copy
}

const TEXT_MAX = { venue: 120, district: 80, language: 80, subtitles: 120, transport: 400, benefit: 300 } as const

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : undefined
}

export function parseEventDetails(raw: unknown): EventDetails | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const out: EventDetails = {}

  if (typeof r.eventDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.eventDate) && !Number.isNaN(Date.parse(r.eventDate))) out.eventDate = r.eventDate
  if (typeof r.startTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(r.startTime)) {
    out.startTime = r.startTime
    out.timeConfirmed = r.timeConfirmed === true
  }
  for (const k of ['venue', 'district', 'language', 'subtitles', 'transport', 'benefit'] as const) {
    const v = text(r[k], TEXT_MAX[k])
    if (v) out[k] = v
  }
  if (typeof r.ticketUrl === 'string' && /^https:\/\//i.test(r.ticketUrl.trim()) && isSafeHref(r.ticketUrl.trim()) && r.ticketUrl.length <= 500) {
    out.ticketUrl = r.ticketUrl.trim()
  }
  return Object.keys(out).length ? out : null
}

/** Host only — what analytics may see of a ticket link (never path/query). */
export function ticketHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

export function formatEventDay(d: string): string {
  // Date-only strings are calendar days; format in UTC so no zone shifts them.
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const FIELD_NAMES: Record<keyof EventDetails, string> = {
  eventDate: 'Event date', startTime: 'Start time', timeConfirmed: 'Time confirmed', venue: 'Venue', district: 'District',
  language: 'Language', subtitles: 'Subtitles', ticketUrl: 'Ticket link', transport: 'Getting there', benefit: 'Smileys benefit',
}

export type EventDetailsInput =
  | { ok: true; data: undefined }          // key not sent — leave the column alone
  | { ok: true; data: EventDetails | null } // null = clear it
  | { ok: false; error: string }

// What the editor sends. `undefined` = untouched; null / an object with nothing
// filled in = remove the card; otherwise every field that was FILLED must pass
// parseEventDetails, so a bad ticket link or date is an error the editor sees,
// not a field that silently vanishes on save.
export function validateEventDetailsInput(raw: unknown): EventDetailsInput {
  if (raw === undefined) return { ok: true, data: undefined }
  if (raw === null) return { ok: true, data: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Event details are malformed' }
  const r = raw as Record<string, unknown>
  const filled = (k: string) => typeof r[k] === 'string' && (r[k] as string).trim() !== ''
  const supplied = (Object.keys(FIELD_NAMES) as (keyof EventDetails)[]).filter(k => k !== 'timeConfirmed' && filled(k))
  if (supplied.length === 0) return { ok: true, data: null }
  const parsed = parseEventDetails(r)
  const bad = supplied.filter(k => !parsed || parsed[k] === undefined)
  if (bad.length) {
    const hint: Partial<Record<keyof EventDetails, string>> = {
      eventDate: 'use a date like 2026-11-04', startTime: 'use 24-hour HH:MM', ticketUrl: 'must be a full https:// link under 500 characters',
    }
    return { ok: false, error: `${bad.map(k => `${FIELD_NAMES[k]} (${hint[k] ?? 'is not valid'})`).join(', ')}` }
  }
  return { ok: true, data: parsed }
}
