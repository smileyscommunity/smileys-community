// Approved seats that owe Smileys money with no live ledger row — the
// 2026-09 production audit found 59 on Smileys-collected events, their rows
// auto-cancelled by the payment sweep, 4 of them checked in.
//
// Lists every approved, non-staff seat on a Smileys-collected event (payTo
// 'smileys', price > 0) with no pending or paid payment: event id / date /
// city, seat id, the member's initial, check-in, whether the payment sweeper
// closed a row for it (its PaymentLog), and the likely cause:
//
//   sweep_cancelled          the sweep closed the pending row 3 days after the
//                            event while the seat stayed approved (checked-in
//                            seats too, before 2026-09)
//   row_cancelled_seat_kept  a row was voided (member cancel, host removal or
//                            move to waitlist, admin cancel) and the seat came
//                            back by approve / promote / add / restore, none of
//                            which wrote a new row
//   refunded                 money went back while the seat stayed approved
//   no_row_ever              never had a row: host/admin add, waitlist
//                            promotion, or collection switched on after they
//                            joined and the sweep's 48h backfill never ran for
//                            it while the event was published
//   other                    only rows in some other status (e.g. failed)
//
//   (default)  READ-ONLY: print, write nothing.
//   APPLY=1    create the missing PENDING row for seats still approved on
//              UPCOMING published events — through lib/rsvpConfirmed's
//              createSeatPayment, so a seat that gained a live row meanwhile
//              is skipped. Nobody is notified, cancelled or refunded. Past
//              events, sweep-cancelled, refunded and 'other' seats are only
//              listed: they are a product decision.
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/audit-seats-without-payment.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/audit-seats-without-payment.ts

import { prisma } from '@/lib/prisma'
import { citiesByToday } from '@/lib/city'
import { createSeatPayment, collectsSeatPayment, LIVE_PAYMENT_STATUSES } from '@/lib/rsvpConfirmed'
import { lockEventRow } from '@/lib/eventCapacity'
import { getInitials } from '@/lib/data'
import { Attendance } from '@/lib/constants'

const APPLY_MODE = process.env.APPLY === '1'

export const BUCKETS = ['sweep_cancelled', 'row_cancelled_seat_kept', 'refunded', 'no_row_ever', 'other'] as const
export type Bucket = typeof BUCKETS[number]

export interface SeatFacts {
  seatId:         string
  userId:         string
  userInitial:    string
  checkedIn:      boolean
  attendance:     string
  isStaff:        boolean
  eventId:        string
  eventTitle:     string
  eventDate:      string   // 'YYYY-MM-DD'
  eventStatus:    string
  eventCancelled: boolean
  city:           string
  cityToday:      string   // 'YYYY-MM-DD' on the event city's clock
  payments:       { status: string; sweepCancelled: boolean }[]
}

export interface PlannedSeat extends SeatFacts {
  bucket:   Bucket
  upcoming: boolean
  action:   'create_pending' | 'list_only'
  why:      string
}

export function bucketFor(payments: SeatFacts['payments']): Bucket {
  if (payments.some(p => p.sweepCancelled))         return 'sweep_cancelled'
  if (payments.some(p => p.status === 'refunded'))  return 'refunded'
  if (payments.some(p => p.status === 'cancelled')) return 'row_cancelled_seat_kept'
  if (payments.length === 0)                        return 'no_row_ever'
  return 'other'
}

/** Pure: which seats to list, which of them APPLY may give a pending row, and the counts. */
export function planSeatPayments(seats: SeatFacts[]) {
  const rows: PlannedSeat[] = []
  let skippedLive = 0
  let skippedStaff = 0
  for (const s of seats) {
    if (s.isStaff) { skippedStaff++; continue }
    if (s.payments.some(p => LIVE_PAYMENT_STATUSES.includes(p.status))) { skippedLive++; continue }
    const bucket   = bucketFor(s.payments)
    const upcoming = s.eventDate >= s.cityToday
    let action: PlannedSeat['action'] = 'list_only'
    let why: string
    if (!upcoming)                                      why = 'past event — product decision'
    else if (s.eventCancelled)                          why = 'event cancelled — left alone'
    else if (s.eventStatus !== 'published')             why = `event is ${s.eventStatus} — left alone`
    else if (bucket === 'no_row_ever' || bucket === 'row_cancelled_seat_kept') {
      action = 'create_pending'
      why    = 'upcoming seat owing nothing on the ledger'
    } else                                              why = `${bucket} — product decision`
    rows.push({ ...s, bucket, upcoming, action, why })
  }
  rows.sort((a, b) => a.eventDate.localeCompare(b.eventDate) || a.eventId.localeCompare(b.eventId) || a.seatId.localeCompare(b.seatId))

  const byBucket = Object.fromEntries(BUCKETS.map(b => [b, rows.filter(r => r.bucket === b).length])) as Record<Bucket, number>
  return {
    rows,
    counts: {
      listed:         rows.length,
      toCreate:       rows.filter(r => r.action === 'create_pending').length,
      pastEvents:     rows.filter(r => !r.upcoming).length,
      checkedIn:      rows.filter(r => r.checkedIn || r.attendance === Attendance.Attended).length,
      sweepCancelled: byBucket.sweep_cancelled,
      skippedLive,
      skippedStaff,
      byBucket,
    },
  }
}

async function loadSeats(): Promise<SeatFacts[]> {
  const [events, days] = await Promise.all([
    prisma.event.findMany({
      where:  { payTo: 'smileys', price: { gt: 0 } },
      select: { id: true, title: true, date: true, status: true, cancelledAt: true, cityId: true, hostId: true, city: { select: { name: true } } },
    }),
    citiesByToday(),
  ])
  if (events.length === 0) return []
  const todayOf  = new Map(days.flatMap(d => d.cityIds.map(id => [id, d.date] as const)))
  const eventIds = events.map(e => e.id)

  const [seats, cohosts, payments] = await Promise.all([
    prisma.eventAttendee.findMany({
      where:  { eventId: { in: eventIds }, status: 'approved' },
      select: { id: true, userId: true, eventId: true, checkedIn: true, attendance: true, user: { select: { name: true } } },
    }),
    prisma.eventCoHost.findMany({ where: { eventId: { in: eventIds } }, select: { eventId: true, userId: true } }),
    prisma.payment.findMany({ where: { eventId: { in: eventIds } }, select: { id: true, userId: true, eventId: true, status: true } }),
  ])
  // The sweeper's close writes adminId 'system' / 'Payment sweeper' (app/api/cron/sweep-payment-reminders).
  const sweepLogs = payments.length
    ? await prisma.paymentLog.findMany({
        where:  { paymentId: { in: payments.map(p => p.id) }, adminId: 'system', adminName: 'Payment sweeper', toStatus: 'cancelled' },
        select: { paymentId: true },
      })
    : []
  const sweptIds = new Set(sweepLogs.map(l => l.paymentId))

  const eventById = new Map(events.map(e => [e.id, e]))
  const staff     = new Set([...events.map(e => `${e.id}:${e.hostId}`), ...cohosts.map(c => `${c.eventId}:${c.userId}`)])
  const bySeat    = new Map<string, SeatFacts['payments']>()
  for (const p of payments) {
    const key = `${p.eventId}:${p.userId}`
    const list = bySeat.get(key) ?? []
    list.push({ status: p.status, sweepCancelled: sweptIds.has(p.id) })
    bySeat.set(key, list)
  }

  return seats.flatMap(s => {
    const e = eventById.get(s.eventId)
    if (!e) return []
    const key = `${s.eventId}:${s.userId}`
    return [{
      seatId: s.id, userId: s.userId,
      userInitial: (getInitials(s.user?.name ?? '') || '?').charAt(0),
      checkedIn: s.checkedIn, attendance: s.attendance,
      isStaff: staff.has(key),
      eventId: e.id, eventTitle: e.title, eventDate: e.date, eventStatus: e.status, eventCancelled: !!e.cancelledAt,
      city: e.city?.name ?? e.cityId,
      // A city missing from the grouping can't be judged upcoming: treat as past (list only).
      cityToday: todayOf.get(e.cityId) ?? '9999-12-31',
      payments: bySeat.get(key) ?? [],
    }]
  })
}

export async function apply(rows: PlannedSeat[]) {
  let created = 0
  let skipped = 0
  for (const r of rows) {
    if (r.action !== 'create_pending') continue
    const made = await prisma.$transaction(async tx => {
      // Event row before createSeatPayment's advisory lock, the order every
      // seat path keeps — a live approve for the same seat would otherwise
      // deadlock this write.
      await lockEventRow(tx, r.eventId)
      // Re-read both sides on the write: the seat must still be approved, and
      // the event still published, collecting and on the date the plan saw.
      const seat  = await tx.eventAttendee.findFirst({ where: { id: r.seatId, userId: r.userId, status: 'approved' }, select: { id: true } })
      const event = await tx.event.findFirst({
        where:  { id: r.eventId, status: 'published', cancelledAt: null, date: r.eventDate },
        select: { price: true, payTo: true, currency: true, hostId: true },
      })
      if (!seat || !event || !collectsSeatPayment(event)) return false
      return createSeatPayment(tx, r.eventId, event, r.userId)
    })
    if (made) created++
    else skipped++
  }
  return { created, skipped }
}

async function main() {
  console.log(APPLY_MODE ? 'APPLY — creating missing pending rows on upcoming events only\n' : 'READ-ONLY — nothing is written. APPLY=1 creates missing pending rows on upcoming events.\n')
  const { rows, counts } = planSeatPayments(await loadSeats())

  // Every row, never truncated.
  for (const r of rows) {
    console.log(
      `  ${r.eventDate} ${r.eventId} [${r.city}] "${r.eventTitle}" (${r.eventCancelled ? 'cancelled' : r.eventStatus})` +
      ` seat=${r.seatId} member=${r.userInitial}.` +
      ` checkedIn=${r.checkedIn ? 'yes' : 'no'} attendance=${r.attendance}` +
      ` sweepCancelled=${r.bucket === 'sweep_cancelled' ? 'yes' : 'no'} bucket=${r.bucket}` +
      ` → ${r.action}: ${r.why}`,
    )
  }
  console.log(`\nsummary: listed=${counts.listed} toCreate=${counts.toCreate} pastEvents=${counts.pastEvents} checkedIn=${counts.checkedIn} sweepCancelled=${counts.sweepCancelled} (skipped: live row=${counts.skippedLive}, staff=${counts.skippedStaff})`)
  console.log(`by bucket: ${BUCKETS.map(b => `${b}=${counts.byBucket[b]}`).join(' ')}`)

  if (!APPLY_MODE) return
  const { created, skipped } = await apply(rows)
  console.log(`\napplied: created=${created} pending row(s), skipped=${skipped} (seat/event changed or a live row appeared)`)
}


// Only run as a CLI — tests import planSeatPayments.
if (/audit-seats-without-payment\.ts$/.test(process.argv[1] ?? '')) {
  main().catch(e => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
}
