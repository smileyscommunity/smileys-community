import { canManagePayments } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { writeAudit } from '@/lib/audit'
import { sendRefundEmail } from '@/lib/email'
import { rateLimit } from '@/lib/rateLimit'

// Allowlist of statuses the API accepts on PATCH. Previously the
// server took whatever string the client sent — admin tooling
// (or a typo) could write `status: 'frzn'` into the DB and the
// UI would silently fall back to default styles, leaving the
// row unfilterable. Locking the set here is the only place the
// state machine is enforced server-side.
//
// `cancelled` is a real DB value (member self-cancel via the RSVP
// route writes it). Adding it here means admin can also mark
// rows as cancelled manually when the RSVP/payment pair gets out
// of sync. Like refunded it's terminal — see TERMINAL_STATUSES.
const ALLOWED_STATUSES = new Set(['paid', 'pending', 'refunded', 'failed', 'cancelled'])

// Refunded + cancelled are terminal at the API level. Refunded
// meant a stray double-click could quietly "un-refund" a payment
// after the member had already received the refund email; cancelled
// is the same shape on the negative side — reverting back to pending
// could re-charge a member who already moved on. Un-doing either
// now requires a deliberate out-of-band action (DB edit or a future
// dedicated admin tool), not an accidental button press.
const TERMINAL_STATUSES = new Set(['refunded', 'cancelled'])

// Notes have no length cap on the schema; cap here so a 50 KB
// note can't land on a single PATCH. Matches the rough length of
// a long refund-reason paragraph.
const MAX_NOTES_LENGTH = 500

// Cap on rows returned by GET so the admin page stays responsive
// once payment volume grows past a few thousand. Summary cards
// stay truthful regardless — they consume server-computed
// aggregates (see GET below) rather than recomputing from the
// row window. If the cap is hit, the client surfaces a "showing
// 500 of N" notice and admins can use search/filter to narrow.
const ROW_CAP = 500

// Rate limits on mutations — admin endpoints, so windows are
// generous but bounded. A compromised admin token can still
// hammer 100 status flips per minute, not 10,000.
const MUTATE_LIMIT_PER_MIN = 100
const DELETE_LIMIT_PER_MIN = 30

async function requireAdmin() {
  const session = await getSession()
  if (!session || !canManagePayments(session)) return null
  return session
}

export async function GET() {
  if (!await requireAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Pull the row window + the four aggregate stats in parallel.
  // Aggregates are computed over the FULL set so the summary
  // cards keep telling the truth once the table starts hitting
  // ROW_CAP. Previously the page derived all stats client-side
  // from the row list, which silently understated once the cap
  // kicked in.
  const [payments, totalCount, paidAgg, pendingCount, byEvent] = await Promise.all([
    prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take:    ROW_CAP,
      include: {
        user:  { select: { name: true, email: true } },
        event: { select: { title: true, emoji: true } },
      },
    }),
    prisma.payment.count(),
    prisma.payment.aggregate({
      where: { status: 'paid' },
      _sum:  { amount: true },
    }),
    prisma.payment.count({ where: { status: 'pending' } }),
    // Per-event aggregates: paid + pending totals so the "Revenue
    // by event" chart can show committed-but-unpaid alongside
    // paid. Computed server-side so the breakdown matches reality
    // regardless of row window.
    prisma.payment.groupBy({
      by:    ['eventId', 'status'],
      _sum:  { amount: true },
      _count: { _all: true },
      where: { status: { in: ['paid', 'pending'] } },
    }),
  ])

  // Resolve event titles + emojis for the byEvent rollup. Single
  // findMany over the distinct eventIds keeps it cheap.
  const eventIds   = [...new Set(byEvent.map(g => g.eventId))]
  const eventMeta  = eventIds.length === 0 ? [] : await prisma.event.findMany({
    where:  { id: { in: eventIds } },
    select: { id: true, title: true, emoji: true },
  })
  const metaById = new Map(eventMeta.map(e => [e.id, e]))
  const byEventStats = Object.values(
    byEvent.reduce<Record<string, { eventId: string; title: string; emoji: string; paidTotal: number; paidCount: number; pendingTotal: number; pendingCount: number }>>((acc, g) => {
      const meta = metaById.get(g.eventId)
      if (!meta) return acc
      if (!acc[g.eventId]) acc[g.eventId] = {
        eventId: g.eventId, title: meta.title, emoji: meta.emoji,
        paidTotal: 0, paidCount: 0, pendingTotal: 0, pendingCount: 0,
      }
      const row = acc[g.eventId]
      const sum   = g._sum.amount ?? 0
      const count = g._count._all
      if (g.status === 'paid')    { row.paidTotal += sum;    row.paidCount += count }
      if (g.status === 'pending') { row.pendingTotal += sum; row.pendingCount += count }
      return acc
    }, {}),
  ).sort((a, b) => b.paidTotal - a.paidTotal)

  return NextResponse.json({
    payments,
    stats: {
      total:        totalCount,
      paidSum:      paidAgg._sum.amount ?? 0,
      pendingCount,
      byEvent:      byEventStats,
      rowCap:       ROW_CAP,
      capped:       totalCount > ROW_CAP,
    },
  })
}

export async function PATCH(req: NextRequest) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Per-admin rate limit. A compromised admin token can still
  // burst, but not at script-level throughput.
  if (!await rateLimit(`payments-patch:${session.id}`, MUTATE_LIMIT_PER_MIN, 60_000)) {
    return NextResponse.json({ error: 'Too many requests — slow down' }, { status: 429 })
  }

  const { id, status, notes } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // Status validation. Both branches are explicit so a malformed
  // payload (e.g. `status: null`) is rejected rather than silently
  // updating the row without the status change.
  if (status !== undefined) {
    if (typeof status !== 'string' || !ALLOWED_STATUSES.has(status)) {
      return NextResponse.json(
        { error: `Invalid status. Allowed: ${[...ALLOWED_STATUSES].join(', ')}` },
        { status: 400 },
      )
    }
  }

  // Length cap on notes. Schema column is unbounded text, so the
  // gate has to live here.
  if (notes !== undefined && typeof notes === 'string' && notes.length > MAX_NOTES_LENGTH) {
    return NextResponse.json({ error: `Notes too long (max ${MAX_NOTES_LENGTH} chars)` }, { status: 400 })
  }

  const current = await prisma.payment.findUnique({
    where: { id },
    select: { status: true, amount: true, currency: true, notes: true },
  })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Refunded is terminal — reject transitions away from it.
  // Defends against the un-refund-by-double-click pattern even if
  // the client UI lets the button through.
  if (status !== undefined && status !== current.status && TERMINAL_STATUSES.has(current.status)) {
    return NextResponse.json(
      { error: `Cannot change status from ${current.status} — terminal state` },
      { status: 409 },
    )
  }

  const updated = await prisma.payment.update({
    where: { id },
    data: {
      ...(status !== undefined && { status }),
      ...(notes  !== undefined && { notes }),
    },
    include: {
      user:  { select: { name: true, email: true } },
      event: { select: { title: true, emoji: true } },
    },
  })

  // Audit branches. Status-change writes both the PaymentLog and
  // the global audit row (same as before). Notes-only changes
  // now write a PaymentLog too — previously these slipped through
  // with no trail, which meant an admin could rewrite "fraud" →
  // "approved manually" silently.
  //
  // refundEmailSent is the C5 fix — when status flips to refunded
  // we now AWAIT the send and surface the result in the response
  // so the client can show a distinct toast ("Refund processed
  // but email failed — notify member manually"). PR 1 only
  // upgraded the swallow to a console.error, which is necessary
  // but not sufficient: admins still saw "Status → refunded" with
  // no signal that the member never heard.
  let refundEmailSent: boolean | undefined
  if (status !== undefined && current.status !== status) {
    await prisma.paymentLog.create({
      data: {
        paymentId: id,
        adminId:   session.id,
        adminName: session.name,
        fromStatus: current.status,
        toStatus:   status,
        note:       notes ?? null,
      },
    })
    writeAudit(session.id, session.name, 'payment.status', id, 'payment',
      { from: current.status, to: status },
      `Payment status changed from ${current.status} to ${status}${notes ? ` — ${notes}` : ''}`,
    )

    if (status === 'refunded') {
      try {
        await sendRefundEmail(
          updated.user.email,
          updated.user.name ?? 'Member',
          updated.event.title,
          current.amount,
          current.currency ?? 'TRY',
          notes,
        )
        refundEmailSent = true
      } catch (err) {
        refundEmailSent = false
        console.error('[payments PATCH] refund email failed', { paymentId: id, err: String(err) })
      }
    }
  } else if (notes !== undefined && (current.notes ?? '') !== (notes ?? '')) {
    // Notes-only edit. Use the existing PaymentLog shape — both
    // fromStatus/toStatus null signals "not a status change", the
    // note field carries the before/after diff so the audit row is
    // self-contained at read time.
    const before = current.notes ?? ''
    const after  = notes ?? ''
    await prisma.paymentLog.create({
      data: {
        paymentId: id,
        adminId:   session.id,
        adminName: session.name,
        fromStatus: null,
        toStatus:   null,
        note:       `Notes edited: "${before}" → "${after}"`,
      },
    })
    writeAudit(session.id, session.name, 'payment.notes', id, 'payment',
      { before, after },
      `Payment notes edited`,
    )
  }

  // Pass-through with a sidecar `_refundEmail` field on refund
  // requests so the client can show the right toast. Absent on
  // every other PATCH so we don't bloat the shape needlessly.
  return NextResponse.json(
    refundEmailSent === undefined ? updated : { ...updated, _refundEmail: { sent: refundEmailSent } },
  )
}

export async function DELETE(req: NextRequest) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Tighter limit on DELETE than PATCH — deletes are destructive
  // even with the audit snapshot, and a compromised admin token
  // shouldn't be able to wipe the whole table.
  if (!await rateLimit(`payments-delete:${session.id}`, DELETE_LIMIT_PER_MIN, 60_000)) {
    return NextResponse.json({ error: 'Too many delete requests — slow down' }, { status: 429 })
  }

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // Snapshot the row before deleting so the audit row records what
  // was lost. Previously the DELETE wrote no PaymentLog and no
  // global audit entry — a paid record could vanish with zero
  // trail of who deleted it or what its values were. Compliance
  // gap fixed by capturing a snapshot first.
  const snapshot = await prisma.payment.findUnique({
    where: { id },
    select: { id: true, amount: true, currency: true, status: true, method: true, notes: true, createdAt: true,
              userId: true, eventId: true, user: { select: { email: true, name: true } }, event: { select: { title: true } } },
  })
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // PaymentLog rows have no FK to Payment in the schema, so they
  // survive the cascade and stay queryable by paymentId. Write a
  // "deletion" sentinel entry so the per-payment audit trail
  // remains complete even after the row is gone.
  await prisma.paymentLog.create({
    data: {
      paymentId: id,
      adminId:   session.id,
      adminName: session.name,
      fromStatus: snapshot.status,
      toStatus:   'deleted',
      note:       `Payment record deleted (₺${snapshot.amount} for ${snapshot.event.title}, member: ${snapshot.user.email})`,
    },
  })
  writeAudit(session.id, session.name, 'payment.delete', id, 'payment',
    {
      amount:   snapshot.amount,
      currency: snapshot.currency,
      status:   snapshot.status,
      method:   snapshot.method,
      userId:   snapshot.userId,
      eventId:  snapshot.eventId,
      createdAt: snapshot.createdAt.toISOString(),
    },
    `Payment record deleted (₺${snapshot.amount} ${snapshot.status}, member: ${snapshot.user.email}, event: ${snapshot.event.title})`,
  )

  await prisma.payment.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
