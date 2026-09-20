import { awaitingCheckIn, type CheckInPromptEvent, type PendingCheckIn } from '@/lib/checkInPrompt'
import { DEFAULT_TZ } from '@/lib/cityTime'

// ── Small client-safe helpers for the host panel (app/host/**) ──────────────
//
// No database import: every page under /host is a client component. Which
// routes ARE the host panel lives in lib/bottomNav, next to the member
// chrome's other route rules.

/**
 * A name reduced to what a person typing it at the door would match on.
 * Turkish lowercasing first ('İ' → 'i', 'I' → 'ı'), then the accents come off
 * and the dotless ı folds into i — so "sukru", "ŞÜKRÜ" and "Şükrü" all find
 * Şükrü, and "ilker" finds "İlker" and "Ilker" alike. Plain toLowerCase()
 * turned 'İ' into 'i' plus a combining dot, which matched nothing typed.
 */
export function searchKey(s: string): string {
  return s.toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i')
}

/** True when `query` (normalised the same way) appears in `name`. Blank matches all. */
export function matchesName(name: string, query: string): boolean {
  const q = searchKey(query.trim())
  return !q || searchKey(name).includes(q)
}

/**
 * The event's own timezone when the API sends one (/api/host/events carries
 * it per event), else the browsed city's. "Today", "started" and "hours left"
 * belong to the city the event is in — a host browsing Istanbul while running
 * a Tbilisi room was told the wrong day.
 */
export function eventTz(e: { timezone?: string | null }, fallback: string = DEFAULT_TZ): string {
  return typeof e.timezone === 'string' && e.timezone ? e.timezone : fallback
}

/**
 * awaitingCheckIn with each event read on its own clock. The shared helper
 * takes one zone for the whole list; a host with rooms in two cities needs
 * each one's deadline in its own.
 */
export function awaitingCheckInPerEvent<E extends CheckInPromptEvent & { timezone?: string | null }>(
  events: E[], fallbackTz: string = DEFAULT_TZ, now: Date = new Date(),
): (PendingCheckIn & { event: E })[] {
  return events
    .flatMap(e => awaitingCheckIn([e], eventTz(e, fallbackTz), now) as (PendingCheckIn & { event: E })[])
    .sort((a, b) => a.hoursLeft - b.hoursLeft)
}

// ── The last good door list, kept on the phone ──────────────────────────────
//
// Check-in happens in basements and on rooftops. A roster that fails to load
// there left the host with nothing; the last one this phone loaded is better
// than that, as long as the page says it is the saved copy. Taps made against
// it wait in lib/checkinQueue as usual. Contact details are left out — the
// door runs on names and faces, and a phone left on a bar needn't hold emails.

const ROSTER_PREFIX = 'smileys_host_roster_'
// Long enough for the review day after the event; anything older is dropped
// on the next save so the storage doesn't collect every room a host ever ran.
const ROSTER_KEEP_MS = 3 * 24 * 60 * 60 * 1000

export interface CachedRoster<A> {
  savedAt:   string
  eventName: string
  eventDate: string
  tz:        string | null
  attendees: A[]
}

type WithUser = { user: { email?: unknown } & Record<string, unknown> }

export function saveRoster<A extends WithUser>(eventId: string, roster: Omit<CachedRoster<A>, 'savedAt'>, now: Date = new Date()): void {
  try {
    const attendees = roster.attendees.map(a => {
      const user = { ...a.user }
      delete user.email
      return { ...a, user }
    })
    localStorage.setItem(ROSTER_PREFIX + eventId, JSON.stringify({ ...roster, attendees, savedAt: now.toISOString() }))
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (!key?.startsWith(ROSTER_PREFIX) || key === ROSTER_PREFIX + eventId) continue
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? '{}')
        if (!saved.savedAt || now.getTime() - new Date(saved.savedAt).getTime() > ROSTER_KEEP_MS) localStorage.removeItem(key)
      } catch { localStorage.removeItem(key) }
    }
  } catch {
    // Private mode or a full quota: the door still works, just without the backup.
  }
}

/**
 * Everything this device cached for the door. Called on sign-out: the roster
 * is names, photos, who was marked absent and who said they came, and it sat
 * in the browser for three days — on the door iPad or a borrowed phone, the
 * next person to use it could read a guest list they have no access to.
 */
export function clearCachedRosters(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(ROSTER_PREFIX)) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
  } catch { /* private mode, or storage disabled */ }
}

export function readRoster<A>(eventId: string): CachedRoster<A> | null {
  try {
    const raw = localStorage.getItem(ROSTER_PREFIX + eventId)
    if (!raw) return null
    const saved = JSON.parse(raw)
    return saved && Array.isArray(saved.attendees) && typeof saved.savedAt === 'string' ? saved : null
  } catch {
    return null
  }
}
