import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { recordCronRun } from '@/lib/cronHealth'
import { citiesByToday } from '@/lib/city'

// Payment-reminder sweeper for pay-in-advance events. Attendees of
// Smileys-collected priced events starting within the next ~48h who
// haven't been marked paid get ONE nudge pointing at the event page
// (where the WhatsApp "Arrange payment" pill lives). One notification,
// not a nag loop: reminderSentAt on the payment row is stamped after
// the send, and stamped rows are never picked up again.
//
// Three passes:
//   1. BACKFILL — approved non-staff attendees with no live payment row
//      (RSVP predated the payTo flip, or admin added them directly) get
//      a pending row created, so the checklist / this sweeper / the
//      payments overview all agree on who owes.
//   2. REMIND — pending rows with reminderSentAt NULL → notify + stamp.
//   3. CLOSE — rows still pending 3+ days after their event auto-cancel
//      with a 'never collected' log, so the ledger can't re-accumulate
//      the phantom-pending pile that was hand-cleaned on 2026-07-08.
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
import { DEFAULT_CURRENCY } from '@/lib/data'

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
      select: { id: true, title: true, date: true, price: true, currency: true, hostId: true },
    })),
  )).flat()

  let created = 0
  let reminded = 0
  for (const event of events) {
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

    // Pass 1: backfill missing ledger rows so "unpaid" is a complete list.
    const live = await prisma.payment.findMany({
      where:  { eventId: event.id, userId: { in: payers }, status: { in: ['pending', 'paid'] } },
      select: { id: true, userId: true, status: true, reminderSentAt: true },
    })
    const hasRow = new Set(live.map(p => p.userId))
    const missing = payers.filter(id => !hasRow.has(id))
    if (missing.length) {
      await prisma.payment.createMany({
        data: missing.map(userId => ({
          userId, eventId: event.id,
          amount: Math.max(0, Number(event.price) || 0),
          currency: event.currency ?? DEFAULT_CURRENCY,
          status: 'pending',
        })),
      })
      created += missing.length
    }

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
    select: { id: true, event: { select: { title: true } } },
  })
  if (stale.length) {
    await prisma.$transaction([
      prisma.payment.updateMany({
        where: { id: { in: stale.map(p => p.id) } },
        data:  { status: 'cancelled' },
      }),
      prisma.paymentLog.createMany({
        data: stale.map(p => ({
          paymentId: p.id, adminId: 'system', adminName: 'Payment sweeper',
          fromStatus: 'pending', toStatus: 'cancelled',
          note: `Auto-cancelled: not collected within 3 days after "${p.event.title}"`,
        })),
      }),
    ])
  }

  if (created || reminded || stale.length) {
    console.log(`[cron sweep-payment-reminders] backfilled ${created} rows, reminded ${reminded} attendees, auto-cancelled ${stale.length} stale pendings`)
  }
  return { events: events.length, backfilled: created, reminded, autoCancelled: stale.length }
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
