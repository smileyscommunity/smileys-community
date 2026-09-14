// Pure helpers shared by the admin participants inbox, the per-event
// participants page and the door check-in list. No React, no fetch — so the
// rules are testable on their own and the three pages can't drift apart.

export interface CapacityLike {
  limitedSpots?: boolean | null
  spotsLeft:     number
  totalSpots:    number
}

/**
 * "Full" is a statement about a cap, and only a limited event has one. An
 * unlimited event still carries totalSpots/spotsLeft (the card derives
 * "X going" from them, and spotsLeft runs negative past the nominal total —
 * see lib/spotsLeft), so reading spotsLeft <= 0 as full labelled every
 * well-attended open event "Full" and blocked its waitlist promotions.
 */
export function isEventFull(e: CapacityLike): boolean {
  return e.limitedSpots === true && e.totalSpots > 0 && e.spotsLeft <= 0
}

/** How many waitlisted members a batch promotion may seat. No cap, no limit. */
export function promotableSeats(e: CapacityLike): number {
  return e.limitedSpots === true ? Math.max(0, e.spotsLeft) : Number.POSITIVE_INFINITY
}

/**
 * Case-insensitive name/email match. Email is optional on purpose: the
 * check-in and participants APIs strip it for co-hosts and club hosts, and a
 * waitlist row whose member was deleted has no user at all.
 */
export function matchesPersonSearch(
  user: { name?: string | null; email?: string | null } | null | undefined,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  if (!user) return false
  return (user.name ?? '').toLowerCase().includes(needle)
    || (user.email ?? '').toLowerCase().includes(needle)
}

// A cell a spreadsheet would evaluate: =, +, -, @ start a formula, and a
// leading tab or CR is how the same payload hides from a naive check.
const FORMULA_LEAD = /^[=+\-@\t\r]/

/**
 * One CSV cell: formula-neutralised (a leading single quote makes Excel,
 * Sheets and Numbers show the text instead of running it) and always quoted,
 * with embedded quotes doubled.
 */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value)
  if (FORMULA_LEAD.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

export function toCsv(rows: unknown[][]): string {
  return rows.map(r => r.map(csvCell).join(',')).join('\n')
}
