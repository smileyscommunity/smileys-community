// Postponed events — the 2026-09 production audit found 20 seats on one with
// no new date, outside every automated handling. READ-ONLY, always: this
// script has no write path. What to do with a postponed event (a date, or a
// cancel that tells everyone) is the host's call; the dashboard pill and the
// weekly host reminder (lib/postponedReminder) are the automated side.
//
// Lists every postponed event: id, old date, city, seats (approved, host and
// co-hosts excluded), pending requests, waitlist, payments pending (count and
// total) and paid, days since it was postponed — from the audit trail's
// status → postponed edit, or from updatedAt when there is none (marked, a
// lower bound) — whether it still needs a new date, and whether its host is
// due a reminder.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/audit-postponed-events.ts

import { prisma } from '@/lib/prisma'
import { loadPostponedEvents, planPostponed, type PostponedRow } from '@/lib/postponedEvents'

/** Pure: the totals line. */
export function summarizePostponed(rows: PostponedRow[]) {
  const noDate = rows.filter(r => r.needsNewDate)
  const pendingByCurrency: Record<string, number> = {}
  for (const r of rows) if (r.paymentsPendingTotal) pendingByCurrency[r.currency] = (pendingByCurrency[r.currency] ?? 0) + r.paymentsPendingTotal
  return {
    events:            rows.length,
    needsNewDate:      noDate.length,
    seatsOnNoDate:     noDate.reduce((s, r) => s + r.seats, 0),
    pendingOnNoDate:   noDate.reduce((s, r) => s + r.pending, 0),
    waitlistOnNoDate:  noDate.reduce((s, r) => s + r.waitlist, 0),
    paymentsPending:   rows.reduce((s, r) => s + r.paymentsPending, 0),
    pendingByCurrency,
    paymentsPaid:      rows.reduce((s, r) => s + r.paymentsPaid, 0),
    hostReminderDue:   rows.filter(r => r.remindHost).length,
    daysFromUpdatedAt: rows.filter(r => !r.fromAudit).length,
  }
}

/** Pure: one line per event. */
export function describePostponed(r: PostponedRow): string {
  return `  ${r.date} ${r.id} [${r.city}] "${r.title}"` +
    ` seats=${r.seats} pending=${r.pending} waitlist=${r.waitlist}` +
    ` payments: pending=${r.paymentsPending} (${r.paymentsPendingTotal} ${r.currency}) paid=${r.paymentsPaid}` +
    ` postponed ${r.daysSincePostponed}d ago${r.fromAudit ? '' : ' (from updatedAt — no audit row, lower bound)'}` +
    ` needsNewDate=${r.needsNewDate ? 'yes' : 'no'} hostReminderDue=${r.remindHost ? 'yes' : 'no'}`
}

async function main() {
  if (process.env.APPLY) console.log('APPLY is ignored — this script is read-only.\n')
  console.log('READ-ONLY — postponed events. Nothing is written, nobody is notified.\n')
  const rows = planPostponed(await loadPostponedEvents(), new Date())
  // Every row, never truncated.
  for (const r of rows) console.log(describePostponed(r))
  const s = summarizePostponed(rows)
  console.log(`\nsummary: postponed=${s.events} needsNewDate=${s.needsNewDate} (seats=${s.seatsOnNoDate} pending=${s.pendingOnNoDate} waitlist=${s.waitlistOnNoDate})` +
    ` paymentsPending=${s.paymentsPending} ${Object.entries(s.pendingByCurrency).map(([c, n]) => `${n} ${c}`).join(' + ') || '0'}` +
    ` paymentsPaid=${s.paymentsPaid} hostReminderDue=${s.hostReminderDue} daysFromUpdatedAt=${s.daysFromUpdatedAt}`)
}

// Only run as a CLI — tests import the pure helpers.
if (/audit-postponed-events\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
