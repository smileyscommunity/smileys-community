// How a marketplace listing READS: its status, its category-specific
// attributes and its contact link.
//
// The sheet on /marketplace and the /board/[id] permalink are two renderings
// of the same row, and every rule they didn't share is a place they drifted —
// the permalink had no gallery, no in-app contact, and a different idea of
// what `contact` holds. Pure and client-safe (no prisma, no next/server): both
// a client component and a server page import it.

import { formatDay } from '@/lib/cityTime'
import { isSafeHref } from '@/lib/safeUrl'

// What a RESOLVED listing is called, per category — the same vocabulary as the
// sheet's resolve button (nobody "fills" a sofa). Used for the status pill, so
// a sold item doesn't read "Filled" in the one place it's shown to its owner.
export const FILLED_LABEL: Record<string, string> = {
  ROOMS: 'Rented', JOBS: 'Filled', PETS: 'Adopted', BUY_SELL: 'Sold',
  FREE: 'Claimed', SERVICES: 'Done', WANTED: 'Found',
}

export interface StatusPill { label: string; cls: string }

/**
 * The pill that says what happened to a listing. `status` is only ever
 * interesting on the owner's own rows and on saved ones that moved on — an
 * every-card "Live" badge is noise, so callers decide when to render it.
 */
export function statusPill(status: string | null | undefined, category: string): StatusPill | null {
  switch (status) {
    case 'active':  return { label: 'Live',                                cls: 'bg-emerald-100 text-emerald-700' }
    case 'filled':  return { label: FILLED_LABEL[category] ?? 'Filled',    cls: 'bg-gray-200 text-gray-700'       }
    case 'expired': return { label: 'Expired',                             cls: 'bg-amber-100 text-amber-800'     }
    case 'deleted': return { label: 'Removed',                             cls: 'bg-red-100 text-red-700'         }
    default:        return null
  }
}

/** True when a listing can still be contacted, saved or renewed into life. */
export function isAvailable(status: string | null | undefined): boolean {
  return status === 'active' || status == null
}

export interface AttrRow { label: string; value: string }

const HOUSING_TYPE: Record<string, string> = {
  room: 'Room', apartment: 'Apartment', roommate: 'Roommate wanted', sublet: 'Sublet',
}
const JOB_TYPE: Record<string, string> = {
  full_time: 'Full-time', part_time: 'Part-time', freelance: 'Freelance', gig: 'One-off gig',
}
const REMOTE: Record<string, string> = {
  remote: 'Remote', in_person: 'In person', hybrid: 'Hybrid',
}
const RATE_UNIT: Record<string, string> = {
  hour: 'Per hour', session: 'Per session', day: 'Per day', fixed: 'Fixed price',
}
const PET_GOAL: Record<string, string> = {
  adoption: 'Adoption', foster: 'Foster',
}

/**
 * The category fields the post form collects and the API allowlists
 * (housing type, available-from, furnished, job type, remote, rate unit,
 * adoption/foster), as a small labelled list. Only keys that are actually
 * present come back, in a fixed order, so the sheet and the permalink list
 * them the same way round.
 *
 * Unknown keys and unknown values are skipped rather than printed raw: the
 * allowlist lives in the API, and a value this function doesn't recognise is
 * one it can't name in English.
 */
export function describeAttrs(attrs: Record<string, unknown> | null | undefined): AttrRow[] {
  if (!attrs || typeof attrs !== 'object') return []
  const rows: AttrRow[] = []
  const pick = (key: string, map: Record<string, string>) => {
    const v = attrs[key]
    return typeof v === 'string' ? map[v] : undefined
  }

  const housing = pick('housingType', HOUSING_TYPE)
  if (housing) rows.push({ label: 'Type', value: housing })

  const from = attrs.availableFrom
  if (typeof from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    // A bare 'YYYY-MM-DD' is a calendar day in the listing's city, not an
    // instant — formatDay renders it without dragging in the viewer's zone,
    // which is what turned "available 1 Oct" into 30 Sept west of UTC.
    rows.push({ label: 'Available from', value: formatDay(from, { day: 'numeric', month: 'long', year: 'numeric' }) })
  }

  if (typeof attrs.furnished === 'boolean') {
    rows.push({ label: 'Furnished', value: attrs.furnished ? 'Yes' : 'No' })
  }

  const job = pick('jobType', JOB_TYPE)
  if (job) rows.push({ label: 'Job type', value: job })

  const remote = pick('remote', REMOTE)
  if (remote) rows.push({ label: 'Where', value: remote })

  const rate = pick('rateUnit', RATE_UNIT)
  if (rate) rows.push({ label: 'Rate', value: rate })

  // `online: false` is the form's default for every service listing, so only
  // the true case says anything.
  if (attrs.online === true) rows.push({ label: 'Online', value: 'Also available online' })

  const pet = pick('petGoal', PET_GOAL)
  if (pet) rows.push({ label: 'Looking for', value: pet })

  return rows
}

export type ContactRender =
  | { kind: 'whatsapp'; href: string }
  | { kind: 'link';     href: string }
  | { kind: 'text';     text: string }
  | null

/**
 * The `contact` field as something safe to render.
 *
 * Writes are validated (a phone number or an https wa.me / api.whatsapp.com
 * link), but rows written before that hold anything a member typed. Both
 * surfaces used to build `https://wa.me/<digits>` from whatever was there and
 * label every http(s) value "Contact on WhatsApp" — so an arbitrary link was
 * presented as WhatsApp, and a `javascript:` one would have been rendered as
 * an href. A host that isn't WhatsApp keeps a neutral label; an unsafe scheme
 * gets no link at all, just the text.
 */
export function contactRender(contact: string | null | undefined): ContactRender {
  if (!contact) return null
  const s = contact.trim()
  if (!s) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//')) {
    if (!isSafeHref(s)) return { kind: 'text', text: s }
    let host = ''
    try { host = new URL(s).hostname.toLowerCase() } catch { return { kind: 'text', text: s } }
    // The hosts the write-side validator accepts (lib/listingContact), plus
    // the www. form of wa.me for rows that predate it.
    const whatsapp = ['wa.me', 'www.wa.me', 'api.whatsapp.com', 'chat.whatsapp.com'].includes(host)
    return whatsapp ? { kind: 'whatsapp', href: s } : { kind: 'link', href: s }
  }
  const digits = s.replace(/\D/g, '')
  // Same floor as the write-side check in lib/listingContact, so a contact the
  // API accepted never renders here as unlinked text; the ceiling is E.164's.
  if (digits.length < 6 || digits.length > 15) return { kind: 'text', text: s }
  return { kind: 'whatsapp', href: `https://wa.me/${digits}` }
}
