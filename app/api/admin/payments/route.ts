import { canManagePayments } from '@/lib/access'
import { requireStepUp } from '@/lib/stepUp'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { writeAudit } from '@/lib/audit'
import { sendRefundEmail, recordEmailFailure } from '@/lib/email'
import { rateLimit } from '@/lib/rateLimit'
import { DEFAULT_CURRENCY, formatMoney } from '@/lib/data'
import { PAYMENT_HELD_CHECKED_IN } from '@/lib/constants'
import { resolveCityId, getCityTz } from '@/lib/city'
import { fromWallClockInTz, shiftDay } from '@/lib/cityTime'
import type { Prisma } from '@prisma/client'

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
//
// Search, status and dates filter HERE, not in the page: filtering the
// 500-row window client-side meant a search for an older payment found
// nothing and the CSV "export" silently stopped at the newest 500 rows.
const ROW_CAP = 500
// The CSV export runs the same filters with a far higher cap. Still a cap
// (the whole table in one JSON body is not a plan), reported when hit.
const EXPORT_CAP = 20_000

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// The page's filters as a Prisma where. Dates are calendar days on the
// admin's city clock — the same clock the rows are displayed on — so
// "from 1 May" starts at midnight there, not at UTC midnight (03:00 in
// Istanbul, which put the first three hours of a day on the day before).
function paymentFilterWhere(
  params: URLSearchParams,
  tz: string,
): Prisma.PaymentWhereInput {
  const status = params.get('status') ?? ''
  const q      = (params.get('search') ?? '').trim().slice(0, 200)
  const from   = params.get('from') ?? ''
  const to     = params.get('to')   ?? ''
  const createdAt: Prisma.DateTimeFilter = {}
  if (DAY_RE.test(from)) createdAt.gte = fromWallClockInTz(`${from}T00:00`, tz)
  // Inclusive of the whole "to" day: everything before the next midnight.
  if (DAY_RE.test(to))   createdAt.lt  = fromWallClockInTz(`${shiftDay(to, 1)}T00:00`, tz)
  const contains = { contains: q, mode: 'insensitive' as const }
  return {
    ...(ALLOWED_STATUSES.has(status) && { status }),
    ...(Object.keys(createdAt).length > 0 && { createdAt }),
    ...(q && { OR: [
      { user:  { name:  contains } },
      { user:  { email: contains } },
      { event: { title: contains } },
      // The RSVP route links staff here with ?search=<userId>.
      { userId: q },
    ] }),
  }
}

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

export async function GET(req: NextRequest) {
  const session = await requireAdmin()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // The admin's city clock (view city → home city → default), the same one
  // useCurrentCity gives the page, which renders row dates in `tz`.
  const tz     = await getCityTz(await resolveCityId(session))
  const params = req.nextUrl.searchParams
  const where  = paymentFilterWhere(params, tz)
  const rowInclude = {
    user:  { select: { name: true, email: true } },
    event: { select: { title: true, emoji: true, city: { select: { name: true, slug: true } } } },
  } as const

  if (params.get('export') === '1') {
    const [payments, matched] = await Promise.all([
      prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, take: EXPORT_CAP, include: rowInclude }),
      prisma.payment.count({ where }),
    ])
    return NextResponse.json({ payments, matched, capped: matched > payments.length, exportCap: EXPORT_CAP, tz })
  }

  // Pull the row window + the four aggregate stats in parallel.
  // Aggregates are computed over the FULL set so the summary
  // cards keep telling the truth once the table starts hitting
  // ROW_CAP. Previously the page derived all stats client-side
  // from the row list, which silently understated once the cap
  // kicked in.
  const [payments, matched, totalCount, paidByCurrency, pendingCount, heldCount, byEvent] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    ROW_CAP,
      include: rowInclude,
    }),
    prisma.payment.count({ where }),
    prisma.payment.count(),
    // Per currency: one sum across lira and lari is not an amount of anything.
    prisma.payment.groupBy({
      by:    ['currency'],
      where: { status: 'paid' },
      _sum:  { amount: true },
    }),
    prisma.payment.count({ where: { status: 'pending' } }),
    // Pending rows the payment sweep held for a checked-in attendee: still
    // counted as pending (nobody has decided), but called out so they get a
    // decision instead of sitting there.
    prisma.payment.count({ where: { status: 'pending', notes: { contains: PAYMENT_HELD_CHECKED_IN } } }),
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
    select: { id: true, title: true, emoji: true, currency: true },
  })
  const metaById = new Map(eventMeta.map(e => [e.id, e]))
  const byEventStats = Object.values(
    byEvent.reduce<Record<string, { eventId: string; title: string; emoji: string; currency: string; paidTotal: number; paidCount: number; pendingTotal: number; pendingCount: number }>>((acc, g) => {
      const meta = metaById.get(g.eventId)
      if (!meta) return acc
      if (!acc[g.eventId]) acc[g.eventId] = {
        eventId: g.eventId, title: meta.title, emoji: meta.emoji, currency: meta.currency ?? DEFAULT_CURRENCY,
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
      paidByCurrency: paidByCurrency
        .map(g => ({ currency: g.currency ?? DEFAULT_CURRENCY, amount: g._sum.amount ?? 0 }))
        .sort((a, b) => b.amount - a.amount),
      pendingCount,
      heldCount,
      byEvent:      byEventStats,
      rowCap:       ROW_CAP,
      // Rows matching the current filters, and whether the list stops
      // short of them. The cards above stay whole-table.
      matched,
      capped:       matched > payments.length,
    },
    tz,
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

  const { id, status, notes, reason } = await req.json()
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

  const current = await prisma.payment.findUnique({
    where: { id },
    select: { status: true, amount: true, currency: true, notes: true },
  })
  if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const statusChanging = status !== undefined && status !== current.status

  // A status change never rewrites the note. The refund reason used to be
  // sent AS `notes`, so refunding a payment replaced whatever was written on
  // it ("paid cash to Elif at the door") with the reason, and the audit only
  // recorded the status. The reason is now appended to the existing note.
  // Text arriving as `notes` alongside a status change (a tab loaded before
  // this change) is treated the same way — nothing sends a note rewrite
  // together with a status flip.
  const rawReason = typeof reason === 'string' ? reason : (statusChanging && typeof notes === 'string' ? notes : '')
  const changeReason = rawReason.trim()
  if (changeReason.length > MAX_NOTES_LENGTH) {
    return NextResponse.json({ error: `Reason too long (max ${MAX_NOTES_LENGTH} chars)` }, { status: 400 })
  }

  // Length cap on notes. Schema column is unbounded text, so the
  // gate has to live here. A note that already runs past the cap (an
  // appended refund reason) can still be edited down, just not grown.
  const notesEdit = !statusChanging && notes !== undefined
  if (notesEdit && typeof notes === 'string' && notes.length > Math.max(MAX_NOTES_LENGTH, (current.notes ?? '').length)) {
    return NextResponse.json({ error: `Notes too long (max ${MAX_NOTES_LENGTH} chars)` }, { status: 400 })
  }

  const nextNotes: string | null | undefined =
    statusChanging
      ? (changeReason
          ? [current.notes?.trim(), `${status === 'refunded' ? 'Refund' : `→ ${status}`}: ${changeReason}`].filter(Boolean).join(' · ')
          : undefined)
      : notes
  const notesChanged = nextNotes !== undefined && (current.notes ?? '') !== (nextNotes ?? '')

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
      ...(notesChanged && { notes: nextNotes }),
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
  //
  // A status change that also changed the note carries the before/after
  // in the same log row and audit entry, so the note's history survives
  // the refund instead of only the new status.
  let refundEmailSent: boolean | undefined
  if (statusChanging) {
    const notesBefore = current.notes ?? ''
    const notesAfter  = nextNotes ?? ''
    await prisma.paymentLog.create({
      data: {
        paymentId: id,
        adminId:   session.id,
        adminName: session.name,
        fromStatus: current.status,
        toStatus:   status,
        note:       notesChanged
          ? `${changeReason} (notes: "${notesBefore}" → "${notesAfter}")`
          : (changeReason || null),
      },
    })
    writeAudit(session.id, session.name, 'payment.status', id, 'payment',
      { from: current.status, to: status, ...(changeReason && { reason: changeReason }), ...(notesChanged && { notesBefore, notesAfter }) },
      `Payment status changed from ${current.status} to ${status}${changeReason ? ` — ${changeReason}` : ''}`,
    )

    if (status === 'refunded') {
      try {
        await sendRefundEmail(
          updated.user.email,
          updated.user.name ?? 'Member',
          updated.event.title,
          current.amount,
          current.currency ?? DEFAULT_CURRENCY,
          changeReason || undefined,
        )
        refundEmailSent = true
      } catch (err) {
        refundEmailSent = false
        console.error('[payments PATCH] refund email failed', { paymentId: id, err: String(err) })
        await recordEmailFailure({ helper: 'sendRefundEmail', recipient: updated.user.email, error: err, context: { paymentId: id, userId: updated.user.email } })
      }
    }
  } else if (notesChanged) {
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

  // Destroying a financial record is the most irreversible thing this panel
  // does — the snapshot below is a trail, not an undo. PATCH stays on the
  // plain admin check: marking a payment paid is routine work.
  const stepUp = requireStepUp(session)
  if (stepUp) return stepUp

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
              userId: true, eventId: true, user: { select: { email: true, name: true } }, event: { select: { title: true, cityId: true } } },
  })
  if (!snapshot) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // PaymentLog rows have no FK to Payment in the schema, so they
  // survive the cascade and stay queryable by paymentId. Write a
  // "deletion" sentinel entry so the per-payment audit trail
  // remains complete even after the row is gone.
  // The sentinel log row and the delete commit together, and the audit is
  // written after — a failed delete used to leave a trail asserting the
  // record was gone while it still existed, and a retry double-logged.
  await prisma.$transaction([
    prisma.paymentLog.create({
      data: {
        paymentId: id,
        adminId:   session.id,
        adminName: session.name,
        fromStatus: snapshot.status,
        toStatus:   'deleted',
        note:       `Payment record deleted (${formatMoney(snapshot.amount, snapshot.currency)} for ${snapshot.event.title}, member: ${snapshot.user.email})`,
      },
    }),
    prisma.payment.delete({ where: { id } }),
  ])
  // cityId from the snapshot: the audit resolves a payment's city through
  // the payment row, which is gone by now.
  writeAudit(session.id, session.name, 'payment.delete', id, 'payment',
    {
      cityId:   snapshot.event.cityId,
      amount:   snapshot.amount,
      currency: snapshot.currency,
      status:   snapshot.status,
      method:   snapshot.method,
      userId:   snapshot.userId,
      eventId:  snapshot.eventId,
      createdAt: snapshot.createdAt.toISOString(),
    },
    `Payment record deleted (${formatMoney(snapshot.amount, snapshot.currency)} ${snapshot.status}, member: ${snapshot.user.email}, event: ${snapshot.event.title})`,
  )
  return NextResponse.json({ ok: true })
}
