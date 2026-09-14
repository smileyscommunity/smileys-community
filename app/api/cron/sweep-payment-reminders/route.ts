import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { recordCronRun } from '@/lib/cronHealth'
import { citiesByToday } from '@/lib/city'
import { backfillSeatPayments } from '@/lib/rsvpConfirmed'
import { Attendance } from '@/lib/constants'

// Payment-reminder sweeper for pay-in-advance events. Attendees of
// Smileys-collected priced events starting within the next ~48h who
// haven't been marked paid get ONE nudge pointing at the event page
// (where the WhatsApp "Arrange payment" pill lives). One notification,
// not a nag loop: reminderSentAt on the payment row is stamped after
// the send, and stamped rows are never picked up again.
//
// Three passes:
//   1. BACKFILL — approved non-staff attendees with no live payment row
//      (RSVP predated the payTo flip, admin added them directly, a voided
//      row whose seat came back) get a pending row, through the same
//      idempotent helper every seat path uses (lib/rsvpConfirmed), so the
//      checklist / this sweeper / the payments overview agree on who owes.
//   2. REMIND — pending rows with reminderSentAt NULL → notify + stamp.
//   3. CLOSE — rows still pending 3+ days after their event auto-cancel
//      with a 'never collected' log, so the ledger can't re-accumulate
//      the phantom-pending pile that was hand-cleaned on 2026-07-08.
//      Except a checked-in attendee's: see pass 3.
//
// This sweeper never touches a seat. A seat with no row at all is given one
// and reminded (passes 1–2), not cancelled; a genuinely unpaid row is closed
// on the ledger only, with its log, and the member keeps their history.
//
// Runs hourly via system crontab; see scripts/sweep-payment-reminders.sh.
//
// Auth: requires `Authorization: Bearer <CRON_SECRET>`. If CRON_SECRET is
// unset, the endpoint refuses with 503 so a misconfigured prod doesn't
// silently leave the sweeper open to the internet.

export const dynamic = 'force-dynamic'

// Cron secret check delegated to lib/cronAuth.ts so the comparison is
// constant-time (timingSafeEqual) instead of `!==`. See that file for
// the rationale.
import { checkCronAuth } from '@/lib/cronAuth'

async function runSweep() {
  // "Today, tomorrow, or the day after" is a claim about the event's own city.
  // Computed once for the network, a city an hour ahead gets its 48h window
  // shifted by a day — members nudged about an event that is not near yet, or
  // not nudged about one that is tonight. Cities sharing a zone share a group,
  // so this stays one query until a city sits in a different one.
  const [startGroups, endGroups] = await Promise.all([citiesByToday(), citiesByToday(2)])
  const cutoffFor = new Map(endGroups.flatMap(g => g.cityIds.map(id => [id, g.date])))
  const windows = startGroups.map(({ date, cityIds }) => ({
    date, cityIds, cutoff: cutoffFor.get(cityIds[0]) ?? date,
  }))

  const events = (await Promise.all(
    windows.map(w => prisma.event.findMany({
      where: {
        payTo:  'smileys',
        price:  { gt: 0 },
        status: 'published',
        cityId: { in: w.cityIds },
        date:   { gte: w.date, lte: w.cutoff },
      },
      select: { id: true, title: true, hostId: true },
    })),
  )).flat()

  let created = 0
  let reminded = 0
  for (const event of events) {
    // Pass 1: backfill missing ledger rows so "unpaid" is a complete list.
    // The helper skips staff and any seat that already has a live row.
    created += await backfillSeatPayments(event.id)

    const [attendees, cohosts] = await Promise.all([
      prisma.eventAttendee.findMany({
        where:  { eventId: event.id, status: 'approved' },
        select: { userId: true },
      }),
      prisma.eventCoHost.findMany({ where: { eventId: event.id }, select: { userId: true } }),
    ])
    const staff  = new Set([event.hostId, ...cohosts.map(c => c.userId)])
    const payers = attendees.map(a => a.userId).filter(id => !staff.has(id))
    if (!payers.length) continue

    // Pass 2: one nudge per unpaid attendee, then stamp so the next tick
    // (and the next event within the window) skips them.
    const toRemind = await prisma.payment.findMany({
      where: {
        eventId: event.id, userId: { in: payers },
        status: 'pending', reminderSentAt: null,
      },
      select: { id: true, userId: true, amount: true, currency: true },
    })
    for (const p of toRemind) {
      createNotification(
        p.userId,
        'payment_reminder',
        '💰 Your spot needs payment',
        `"${event.title}" is coming up — ${p.amount} ${p.currency} is still due. Tap to arrange payment.`,
        `/events/${event.id}`,
      ).catch(() => {})
      await prisma.payment.update({
        where: { id: p.id },
        data:  { reminderSentAt: new Date() },
      })
      reminded++
    }
  }

  // Pass 3: post-event ledger hygiene. Still pending 3+ days after the
  // event means the money was never collected — close the row (history
  // stays queryable via PaymentLog; repeat no-payers become visible).
  // Not scoped to payTo: catches strays on events whose payTo changed too.
  // Same per-city rule, three days back: closing a ledger row early because
  // another city's calendar turned first would cancel a payment that is still
  // legitimately pending where the event happened.
  const staleGroups = await citiesByToday(-3)
  const stale = await prisma.payment.findMany({
    where: {
      status: 'pending',
      OR: staleGroups.map(({ date, cityIds }) => ({
        event: { date: { lt: date }, cityId: { in: cityIds } },
      })),
    },
    select: { id: true, userId: true, eventId: true, event: { select: { title: true } } },
  })

  // Someone checked in at the door came. "Never collected" is not what
  // happened to them — the money changed hands unrecorded, or is still owed
  // by someone who was in the room — and closing their row wrote exactly that
  // (4 checked-in attendees in the 2026-09 audit). Their row stays pending
  // for an admin to mark paid or cancel by hand.
  const attended = stale.length
    ? await prisma.eventAttendee.findMany({
        where: {
          eventId: { in: [...new Set(stale.map(p => p.eventId))] },
          userId:  { in: [...new Set(stale.map(p => p.userId))] },
          OR:      [{ checkedIn: true }, { attendance: Attendance.Attended }],
        },
        select: { userId: true, eventId: true },
      })
    : []
  const came = new Set(attended.map(a => `${a.eventId}:${a.userId}`))

  let autoCancelled = 0
  let heldCheckedIn = 0
  for (const p of stale) {
    if (came.has(`${p.eventId}:${p.userId}`)) { heldCheckedIn++; continue }
    // Guarded on the status just read: a row an admin marks paid between the
    // read and this write stays paid, and gets no "auto-cancelled" log.
    autoCancelled += await prisma.$transaction(async tx => {
      const { count } = await tx.payment.updateMany({
        where: { id: p.id, status: 'pending' },
        data:  { status: 'cancelled' },
      })
      if (count) {
        await tx.paymentLog.create({
          data: {
            paymentId: p.id, adminId: 'system', adminName: 'Payment sweeper',
            fromStatus: 'pending', toStatus: 'cancelled',
            note: `Auto-cancelled: not collected within 3 days after "${p.event.title}"`,
          },
        })
      }
      return count
    })
  }

  if (created || reminded || autoCancelled || heldCheckedIn) {
    console.log(`[cron sweep-payment-reminders] backfilled ${created} rows, reminded ${reminded} attendees, auto-cancelled ${autoCancelled} stale pendings, held ${heldCheckedIn} for checked-in attendees`)
  }
  return { events: events.length, backfilled: created, reminded, autoCancelled, heldCheckedIn }
}

export async function POST(req: NextRequest) {
  const denied = await checkCronAuth(req)
  if (denied) return denied

  try {
    const result = await runSweep()
    await recordCronRun('sweep-payment-reminders', true)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-payment-reminders]', e)
    await recordCronRun('sweep-payment-reminders', false, e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}

// No GET handler: the old "?key=<CRON_SECRET>" browser-testing path put
// the secret in query strings (nginx access logs, browser history) — the
// same class as the 2026-08 DB-password-in-crontab incident. Test with:
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" <url>
