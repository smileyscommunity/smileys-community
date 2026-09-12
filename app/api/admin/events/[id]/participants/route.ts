import { NextRequest, NextResponse } from 'next/server'
import { findPromotableFromWaitlist, hasQuotaRoomFor, quotaEventSelect } from '@/lib/eventQuota'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isClubHost, canManageEventOps } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { sendEventApprovedEmail, sendEventRejectedEmail, recordEmailFailure } from '@/lib/email'
import { autoJoinClub } from '@/lib/autoJoinClub'

import { recomputeSpotsLeft } from '@/lib/spotsLeft'
import { writeAudit } from '@/lib/audit'
import { activateAttendee, activeAttendeeWhere, cancelAttendeeOp, isActiveAttendee, type CancelActor } from '@/lib/attendance'
import { getRsvpGate, gateErrorBody } from '@/lib/noShow'
import { CardStatus } from '@/lib/noShowPolicy'
import { DEFAULT_CURRENCY } from '@/lib/data'
import { rateLimit } from '@/lib/rateLimit'

// Who is taking the member off the event, for the soft-cancel stamp.
// Everyone past canManageEventOps who isn't an admin is some kind of host.
const cancelActor = (session: { role: string }): CancelActor => session.role === 'admin' ? 'admin' : 'host'

// Door work is bursty (a host clearing a queue), so the budget is generous —
// same 120/min as check-in. It exists so a runaway client can't fan out
// notifications and emails at script speed.
const overParticipantOpsLimit = async (sessionId: string) =>
  !await rateLimit(`participants-ops:${sessionId}`, 120, 60_000)

const PATCH_ACTIONS = ['approve', 'reject', 'toWaitlist', 'markPaid', 'markUnpaid'] as const

// AD2 helper: when an admin removes an attendee, handle their
// payments the same way the member-cancel flow does. Pending
// payments → cancelled with a PaymentLog (note: "Admin removed
// attendee"). Paid payments → stay paid (money was actually
// collected) but write an informational PaymentLog flagging
// refund-pending. Plus a global audit entry on the user level
// so cross-event admin actions are queryable.
//
// Returns nothing — fire-and-forget shape. The caller has
// already removed the attendee row; this just cleans up the
// financial trail.
async function auditAttendeeRemoval(opts: {
  session: { id: string; name: string }
  userId: string
  eventId: string
  reason: 'delete' | 'reject' | 'to_waitlist'
  eventTitle?: string | null
}) {
  const { session, userId, eventId, reason, eventTitle } = opts
  const reasonLabel =
    reason === 'reject'      ? 'Admin rejected RSVP'
    : reason === 'to_waitlist' ? 'Admin moved attendee to waitlist'
    : 'Admin removed attendee'

  const [pending, paid] = await Promise.all([
    prisma.payment.findMany({
      where:  { userId, eventId, status: 'pending' },
      select: { id: true, amount: true, currency: true },
    }),
    prisma.payment.findMany({
      where:  { userId, eventId, status: 'paid' },
      select: { id: true, amount: true, currency: true },
    }),
  ])

  if (pending.length > 0) {
    await prisma.$transaction([
      prisma.payment.updateMany({
        where: { userId, eventId, status: 'pending' },
        data: { status: 'cancelled' },
      }),
      prisma.paymentLog.createMany({
        data: pending.map(p => ({
          paymentId:  p.id,
          adminId:    session.id,
          adminName:  session.name,
          fromStatus: 'pending',
          toStatus:   'cancelled',
          note:       `${reasonLabel} (${p.amount} ${p.currency})`,
        })),
      }),
    ])
  }

  if (paid.length > 0) {
    await prisma.paymentLog.createMany({
      data: paid.map(p => ({
        paymentId:  p.id,
        adminId:    session.id,
        adminName:  session.name,
        fromStatus: null,
        toStatus:   null,
        note:       `${reasonLabel} — payment still 'paid', refund pending review (${p.amount} ${p.currency})`,
      })),
    })
  }

  writeAudit(session.id, session.name, `attendee.${reason}`, eventId, 'event',
    {
      userId,
      pendingCount: pending.length,
      paidCount:    paid.length,
      paidTotal:    paid.reduce((s, p) => s + p.amount, 0),
    },
    `${reasonLabel}${eventTitle ? ` for "${eventTitle}"` : ''} (member: ${userId}${
      pending.length || paid.length
        ? ` — payments: ${pending.length} pending → cancelled, ${paid.length} paid still need refund review`
        : ''
    })`,
  )
}

type Params = { params: Promise<{ id: string }> }

// Balance quotas for a manual seat (PUT add, POST promote): 409 with the
// reason when the member's side is full, null when there is room.
async function quotaBlockFor(eventId: string, event: Parameters<typeof hasQuotaRoomFor>[1], userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { gender: true, nationality: true } })
  const room = await hasQuotaRoomFor(eventId, event, { gender: user?.gender ?? null, nationality: user?.nationality ?? null })
  if (room.ok) return null
  return NextResponse.json({ error: 'That seat is reserved for balance on this event', reason: room.reason }, { status: 409 })
}

const userSelect = { id: true, name: true, color: true, email: true, profilePhoto: true, gender: true, nationality: true, phone: true }

// Shared predicate — see lib/access.canManageEventOps (adds co-hosts, one home).

export async function GET(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id: eventId } = await params
    if (!await canManageEventOps(session.id, session.role, eventId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [attendeesRaw, waitlistRaw, cohosts, eventRow, payments, noShowCards] = await Promise.all([
      prisma.eventAttendee.findMany({
        where: { eventId, ...activeAttendeeWhere },
        include: { user: { select: userSelect } },
        orderBy: { joinedAt: 'asc' },
      }),
      prisma.waitlistEntry.findMany({
        where: { eventId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.eventCoHost.findMany({ where: { eventId }, select: { userId: true } }),
      prisma.event.findUnique({ where: { id: eventId }, select: { hostId: true } }),
      // Payment checklist for Smileys-collected events — live ledger rows
      // only (cancelled/refunded are history, not door state).
      prisma.payment.findMany({
        where:   { eventId, status: { in: ['pending', 'paid'] } },
        select:  { id: true, userId: true, status: true, amount: true, currency: true },
        orderBy: { createdAt: 'asc' },
      }),
      // No-show cards from this event, for the host's waive button. Includes
      // late-cancel cards, whose attendee rows are not in the list above.
      prisma.noShowCard.findMany({
        where:   { eventId },
        select:  { id: true, userId: true, kind: true, status: true, waivedAt: true, notifiedAt: true, user: { select: { id: true, name: true } } },
        orderBy: { issuedAt: 'asc' },
      }),
    ])

    const excludeIds = new Set([
      eventRow?.hostId,
      ...cohosts.map(c => c.userId),
    ].filter(Boolean) as string[])

    // A yellow card is a private warning to the member — hosts never see it
    // on the approved list or the waitlist. The one place it informs a
    // decision is the approval queue, so pending rows (and only those) carry
    // the member's ACTIVE cards from any event, as counts, not history. Red
    // cards enforce themselves at RSVP time, so a red here means the request
    // predates the restriction.
    const pendingIds = attendeesRaw.filter(a => a.status === 'pending').map(a => a.userId)
    const activeCardRows = pendingIds.length
      ? await prisma.noShowCard.findMany({
          where:  { userId: { in: pendingIds }, status: { in: [CardStatus.Active, CardStatus.AppealPending] } },
          select: { userId: true, kind: true },
        })
      : []
    const activeCards = new Map<string, { yellow: number; red: number }>()
    for (const c of activeCardRows) {
      const cur = activeCards.get(c.userId) ?? { yellow: 0, red: 0 }
      if (c.kind === 'red') cur.red++; else cur.yellow++
      activeCards.set(c.userId, cur)
    }

    // Keep all in the list for display, but tag host/cohost so client can distinguish
    const attendees = attendeesRaw.map(a => ({
      ...a,
      isStaff: excludeIds.has(a.userId),
      ...(a.status === 'pending' ? { activeCards: activeCards.get(a.userId) ?? { yellow: 0, red: 0 } } : {}),
    }))

    const waitlistUserIds = waitlistRaw.map(w => w.userId)
    const waitlistUsers = waitlistUserIds.length
      ? await prisma.user.findMany({ where: { id: { in: waitlistUserIds } }, select: userSelect })
      : []
    const userMap = Object.fromEntries(waitlistUsers.map(u => [u.id, u]))
    const waitlist = waitlistRaw.map(w => ({ ...w, user: userMap[w.userId] }))

    // Contact details follow the check-in route's rule: admins and the
    // primary host only. Co-hosts and club hosts run the door by name and
    // photo; gender and nationality stay, since balance quotas are theirs to
    // manage.
    const canSeeContact = session.role === 'admin' || eventRow?.hostId === session.id
    const stripContact = <T extends { user?: { email?: unknown; phone?: unknown } | null }>(row: T): T => {
      if (canSeeContact || !row.user) return row
      const { email: _e, phone: _p, ...user } = row.user
      return { ...row, user } as T
    }

    return NextResponse.json({ attendees: attendees.map(stripContact), waitlist: waitlist.map(stripContact), payments, noShowCards })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// DELETE — remove attendee or waitlist entry
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (await overParticipantOpsLimit(session.id)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id: eventId } = await params
    if (!await canManageEventOps(session.id, session.role, eventId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { userId, type } = await req.json().catch(() => ({}))
    if (typeof userId !== 'string' || !userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 })
    }

    if (type === 'waitlist') {
      await prisma.waitlistEntry.deleteMany({ where: { eventId, userId } })
      return NextResponse.json({ ok: true })
    }

    const [entry, eventRow] = await Promise.all([
      prisma.eventAttendee.findUnique({ where: { userId_eventId: { userId, eventId } } }),
      prisma.event.findUnique({ where: { id: eventId }, select: { title: true, approvalRequired: true, ...quotaEventSelect } }),
    ])
    await cancelAttendeeOp(prisma, { userId, eventId, by: cancelActor(session) })

    // AD2 fix: handle the member's payments + write an audit row.
    // Previously the admin path silently deleted attendees and
    // left pending payment rows hanging in 'pending' forever +
    // paid rows with no record that the underlying RSVP was
    // gone. Now matches the member-cancel flow (PR-A / P2 / P8).
    await auditAttendeeRemoval({
      session,
      userId,
      eventId,
      reason:     'delete',
      eventTitle: eventRow?.title,
    })

    if (entry?.status === 'approved') {
      // Promote the first person on the waitlist WHOSE SIDE HAS ROOM, or free
      // the spot. Taking the head of the queue unconditionally is how a
      // gender-balanced event drifts past its own cap: a woman cancels, the
      // next in line is a man, and the male count steps over the quota that
      // the approval path is careful to enforce. Order still decides who goes
      // first; the quota decides who is eligible.
      const next = eventRow ? await findPromotableFromWaitlist(eventId, eventRow) : null
      if (next) {
        await prisma.$transaction(async (tx) => {
          await tx.waitlistEntry.delete({ where: { id: next.id } })
          await activateAttendee(tx, { userId: next.userId, eventId, status: 'approved' })
        })
        createNotification(next.userId, 'waitlist_promoted', 'Spot available! 🎉',
          `A spot opened up for "${eventRow?.title}" — you're in!`, `/events/${eventId}`)
      }
      // Recompute in every branch — the blind increment could creep past
      // totalSpots on repeated remove cycles; recompute clamps both ends.
      if (eventRow) await recomputeSpotsLeft(eventId, eventRow.totalSpots)
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// PATCH — approve or reject a pending attendee
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (await overParticipantOpsLimit(session.id)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id: eventId } = await params
    if (!await canManageEventOps(session.id, session.role, eventId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { userId, action } = await req.json().catch(() => ({}))
    // An unknown action used to fall through every branch and answer 200 —
    // a typo'd client looked like it worked.
    if (!PATCH_ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
    // Same guard as DELETE/PUT/POST. Prisma drops an undefined filter, so a
    // markPaid with no userId found (and flipped) whichever payment on the
    // event came back first.
    if (typeof userId !== 'string' || !userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 })
    }

    // Payment checklist ops — money handling is admin-only. Hosts manage
    // attendance above, but flipping paid states on Smileys-collected
    // events stays with admins (they reconcile the bank side).
    if (action === 'markPaid' || action === 'markUnpaid') {
      if (session.role !== 'admin') {
        return NextResponse.json({ error: 'Admin only' }, { status: 403 })
      }
      const evt = await prisma.event.findUnique({
        where: { id: eventId }, select: { title: true, price: true, currency: true },
      })
      if (!evt) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
      const existing = await prisma.payment.findFirst({
        where:   { userId, eventId, status: { in: ['pending', 'paid'] } },
        orderBy: { createdAt: 'desc' },
      })

      if (action === 'markPaid') {
        if (existing?.status === 'paid') return NextResponse.json({ ok: true, payment: existing })
        let payment
        if (existing) {
          payment = await prisma.payment.update({ where: { id: existing.id }, data: { status: 'paid' } })
          await prisma.paymentLog.create({
            data: { paymentId: existing.id, adminId: session.id, adminName: session.name,
                    fromStatus: 'pending', toStatus: 'paid', note: `Marked paid on participants checklist ("${evt.title}")` },
          })
        } else {
          // No ledger row — RSVP predates the payTo flip, or the member was
          // added directly by an admin. Create it as paid so the checklist
          // and the payments overview agree.
          payment = await prisma.payment.create({
            data: { userId, eventId, amount: Math.max(0, Number(evt.price) || 0),
                    currency: evt.currency ?? DEFAULT_CURRENCY, status: 'paid', method: 'manual' },
          })
          await prisma.paymentLog.create({
            data: { paymentId: payment.id, adminId: session.id, adminName: session.name,
                    fromStatus: null, toStatus: 'paid', note: `Created + marked paid on participants checklist ("${evt.title}")` },
          })
        }
        return NextResponse.json({ ok: true, payment })
      }

      // markUnpaid — only meaningful as an undo of 'paid'.
      if (!existing || existing.status !== 'paid') {
        return NextResponse.json({ error: 'No paid payment to revert' }, { status: 400 })
      }
      const payment = await prisma.payment.update({ where: { id: existing.id }, data: { status: 'pending' } })
      await prisma.paymentLog.create({
        data: { paymentId: existing.id, adminId: session.id, adminName: session.name,
                fromStatus: 'paid', toStatus: 'pending', note: `Reverted to unpaid on participants checklist ("${evt.title}")` },
      })
      return NextResponse.json({ ok: true, payment })
    }

    const [event, user, current] = await Promise.all([
      prisma.event.findUnique({ where: { id: eventId }, select: { title: true, status: true, spotsLeft: true, date: true, neighborhood: true, turkishMaleQuota: true, genderBalance: true, maleQuota: true, femaleQuota: true, totalSpots: true, approvalRequired: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, gender: true, nationality: true } }),
      prisma.eventAttendee.findUnique({ where: { userId_eventId: { userId, eventId } }, select: { status: true } }),
    ])

    // Approve / reject act on a LIVE request. The row of a member who
    // already withdrew stays in the table now (soft-cancel), so without
    // this a stale participants tab could approve someone into a spot they
    // gave up — or email a rejection for a request they cancelled.
    if ((action === 'approve' || action === 'reject') && !isActiveAttendee(current)) {
      return NextResponse.json({ error: 'Not an attendee of this event' }, { status: 404 })
    }
    // A red-card block holds here as it does for PUT/POST: approving gives a
    // seat, and "to waitlist" gives a place in the queue — neither for a
    // member whose RSVPs are paused. Reject and remove stay open.
    if (action === 'approve' || action === 'toWaitlist') {
      const gate = await getRsvpGate(userId)
      if (!gate.ok && gate.code === 'red_card_blocked') {
        return NextResponse.json(gateErrorBody(gate), { status: 409 })
      }
    }

    // Normalize so 'Male' / 'MALE' / 'male' and 'Türkiye' / 'Turkey' / 'TR'
    // all compare equal — same approach as the RSVP route.
    const userGender = (user?.gender ?? '').trim().toLowerCase()
    const userNat    = (user?.nationality ?? '').trim().toLowerCase()
    const TURKISH    = new Set(['turkey', 'türkiye', 'turkiye', 'tr', 'turkish'])
    const isMale     = userGender === 'male'
    const isFemale   = userGender === 'female'
    const isTurkish  = TURKISH.has(userNat)
    // The same broad value sets used in the where clauses for case-insensitive
    // counts. (Prisma doesn't have a built-in case-insensitive enum match,
    // so we list the practical variants explicitly.)
    const MALE_VARIANTS    = ['male', 'Male', 'MALE']
    const FEMALE_VARIANTS  = ['female', 'Female', 'FEMALE']
    const TURKEY_VARIANTS  = ['Turkey', 'turkey', 'Türkiye', 'türkiye', 'Turkiye', 'TR']

    // toWaitlist too: a place in the queue of a closed event is a promise
    // nothing will keep, and it cancels the seat they held.
    if ((action === 'approve' || action === 'toWaitlist') && (event?.status === 'cancelled' || event?.status === 'archived')) {
      return NextResponse.json({ error: action === 'approve' ? 'Cannot approve into a cancelled or archived event' : 'Cannot waitlist for a cancelled or archived event' }, { status: 400 })
    }

    if (action === 'approve') {
      // Turkish male quota check
      if (event?.turkishMaleQuota && isMale && isTurkish) {
        const turkishMaleCount = await prisma.eventAttendee.count({
          where: { eventId, status: 'approved', user: { gender: { in: MALE_VARIANTS }, nationality: { in: TURKEY_VARIANTS } } },
        })
        if (turkishMaleCount >= event.turkishMaleQuota) {
          // Move to waitlist instead
          // Transactional + upsert, same as the toWaitlist action below: a
          // plain create throws P2002 when they already sit on the waitlist
          // from an earlier round — AFTER the delete committed, silently
          // removing them from the event entirely.
          await prisma.$transaction([
            cancelAttendeeOp(prisma, { userId, eventId, by: cancelActor(session) }),
            prisma.waitlistEntry.upsert({
              where:  { userId_eventId: { userId, eventId } },
              create: { userId, eventId },
              update: {},
            }),
          ])
          createNotification(userId, 'waitlist', 'Added to waitlist 📋',
            `Turkish male spots for "${event.title}" are full — you're on the waitlist.`, `/events/${eventId}`)
          return NextResponse.json({ ok: true, status: 'waitlisted', reason: 'turkish_male_quota' })
        }
      }

      // General male quota check
      if (event?.genderBalance && isMale) {
        const maleQuota = event.maleQuota ?? Math.floor(event.totalSpots / 2)
        const maleCount = await prisma.eventAttendee.count({
          where: { eventId, status: 'approved', user: { gender: { in: MALE_VARIANTS } } },
        })
        if (maleCount >= maleQuota) {
          // Transactional + upsert, same as the toWaitlist action below: a
          // plain create throws P2002 when they already sit on the waitlist
          // from an earlier round — AFTER the delete committed, silently
          // removing them from the event entirely.
          await prisma.$transaction([
            cancelAttendeeOp(prisma, { userId, eventId, by: cancelActor(session) }),
            prisma.waitlistEntry.upsert({
              where:  { userId_eventId: { userId, eventId } },
              create: { userId, eventId },
              update: {},
            }),
          ])
          createNotification(userId, 'waitlist', 'Added to waitlist 📋',
            `Male spots for "${event.title}" are full — you're on the waitlist.`, `/events/${eventId}`)
          return NextResponse.json({ ok: true, status: 'waitlisted', reason: 'male_quota' })
        }
      }

      // Female quota check — mirrors the male side, fallback included. A null
      // femaleQuota used to mean "uncapped", so ticking gender balance capped
      // the men at half the room and let the women fill the rest.
      if (event?.genderBalance && isFemale) {
        const femaleQuota = event.femaleQuota ?? Math.floor(event.totalSpots / 2)
        const femaleCount = await prisma.eventAttendee.count({
          where: { eventId, status: 'approved', user: { gender: { in: FEMALE_VARIANTS } } },
        })
        if (femaleCount >= femaleQuota) {
          // Transactional + upsert, same as the toWaitlist action below: a
          // plain create throws P2002 when they already sit on the waitlist
          // from an earlier round — AFTER the delete committed, silently
          // removing them from the event entirely.
          await prisma.$transaction([
            cancelAttendeeOp(prisma, { userId, eventId, by: cancelActor(session) }),
            prisma.waitlistEntry.upsert({
              where:  { userId_eventId: { userId, eventId } },
              create: { userId, eventId },
              update: {},
            }),
          ])
          createNotification(userId, 'waitlist', 'Added to waitlist 📋',
            `Female spots for "${event.title}" are full — you're on the waitlist.`, `/events/${eventId}`)
          return NextResponse.json({ ok: true, status: 'waitlisted', reason: 'female_quota' })
        }
      }

      await prisma.eventAttendee.update({
        where: { userId_eventId: { userId, eventId } },
        data: { status: 'approved' },
      })
      // Recompute, never a blind decrement — approving into a full event
      // used to push spotsLeft negative until the nightly sweep clamped it.
      if (event) await recomputeSpotsLeft(eventId, event.totalSpots)
      autoJoinClub(userId, eventId).catch(() => {})
      createNotification(userId, 'rsvp', 'You\'re in! 🎉', `Your request for "${event?.title}" has been approved.`, `/events/${eventId}`)
      if (user?.email && event) {
        // EM1 fix: log SMTP failures instead of swallowing. Admin
        // who approves a member expects them to get an email; if
        // delivery fails, member sees no signal and admin assumes
        // it landed. Surface via server log so it's at least
        // grep-able by eventId/userId when complaints come in.
        sendEventApprovedEmail(user.email, user.name, event.title, event.date, event.neighborhood ?? '', eventId)
          .catch(err => {
            console.error('[participants PATCH approve] sendEventApprovedEmail failed', { eventId, userId, err: String(err) })
            return recordEmailFailure({ helper: 'sendEventApprovedEmail', recipient: user.email, error: err, context: { eventId, userId } })
          })
      }
    } else if (action === 'toWaitlist') {
      // Move an approved attendee back to the waitlist without removing them
      // from the event. The quota paths already do exactly this when someone
      // doesn't fit; this is the same move made by hand — for the attendee who
      // is already over a cap, or when a host needs to free a spot without
      // telling someone they're out.
      //
      // Keeps their place: a waitlist row created now sorts last, which is the
      // honest position for someone who held a spot and gave it up.
      const existing = await prisma.eventAttendee.findUnique({
        where:  { userId_eventId: { userId, eventId } },
        select: { status: true },
      })
      if (!isActiveAttendee(existing)) {
        return NextResponse.json({ error: 'Not an attendee of this event' }, { status: 404 })
      }
      const [, waitlisted] = await prisma.$transaction([
        cancelAttendeeOp(prisma, { userId, eventId, by: cancelActor(session) }),
        // They may already sit on the waitlist from an earlier round; the
        // unique (userId, eventId) makes a plain create throw there.
        prisma.waitlistEntry.upsert({
          where:  { userId_eventId: { userId, eventId } },
          create: { userId, eventId },
          update: {},
          select: { id: true, userId: true, createdAt: true },
        }),
      ])
      // Same payment handling as any other removal — a pending charge must not
      // outlive the spot it was for, and a paid one needs refund review.
      await auditAttendeeRemoval({
        session,
        userId,
        eventId,
        reason:     'to_waitlist',
        eventTitle: event?.title,
      })
      // Only an approved attendee was holding a spot; a pending request wasn't.
      if (existing.status === 'approved' && event) {
        await recomputeSpotsLeft(eventId, event.totalSpots)
      }
      createNotification(userId, 'waitlist', 'Moved to the waitlist 📋',
        `Your spot for "${event?.title}" was moved to the waitlist — we'll let you know if one opens up.`,
        `/events/${eventId}`)
      // Hand back the real row: the admin page moves them between two lists on
      // screen, and inventing an id/createdAt for that is how a UI drifts from
      // what the database actually holds.
      return NextResponse.json({ ok: true, waitlisted })
    } else if (action === 'reject') {
      await cancelAttendeeOp(prisma, { userId, eventId, by: cancelActor(session) })
      // AD2 fix: reject path needs the same payment-aware audit
      // as DELETE. A rejected RSVP is functionally identical to
      // an admin-removed attendee from the payment side — pending
      // rows get cancelled, paid rows need refund review.
      await auditAttendeeRemoval({
        session,
        userId,
        eventId,
        reason:     'reject',
        eventTitle: event?.title,
      })
      createNotification(userId, 'rsvp_pending', 'Request not approved', `Unfortunately your request for "${event?.title}" was not approved this time.`, `/events/${eventId}`)
      if (user?.email && event) {
        // EM1 fix: same logging treatment as the approve path.
        sendEventRejectedEmail(user.email, user.name, event.title)
          .catch(err => {
            console.error('[participants PATCH reject] sendEventRejectedEmail failed', { eventId, userId, err: String(err) })
            return recordEmailFailure({ helper: 'sendEventRejectedEmail', recipient: user.email, error: err, context: { eventId, userId } })
          })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// PUT — directly add any member as an approved attendee
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (await overParticipantOpsLimit(session.id)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id: eventId } = await params
    if (!await canManageEventOps(session.id, session.role, eventId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { userId } = await req.json().catch(() => ({}))
    if (typeof userId !== 'string' || !userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { title: true, spotsLeft: true, approvalRequired: true, hostId: true, status: true, ...quotaEventSelect },
    })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (event.hostId === userId) return NextResponse.json({ error: 'Hosts are automatically attending their own events' }, { status: 400 })
    if (event.status === 'cancelled' || event.status === 'archived') {
      return NextResponse.json({ error: 'Cannot add to a cancelled or archived event' }, { status: 400 })
    }

    const existing = await prisma.eventAttendee.findUnique({
      where: { userId_eventId: { userId, eventId } },
    })
    if (isActiveAttendee(existing)) return NextResponse.json({ error: 'Already attending' }, { status: 409 })

    // A red-card block holds for a host's manual add too — otherwise it is
    // a rule for one button only. (A yellow card's confirmation is the
    // member's own promise, not something a host makes for them.)
    const gate = await getRsvpGate(userId)
    if (!gate.ok && gate.code === 'red_card_blocked') {
      return NextResponse.json(gateErrorBody(gate), { status: 409 })
    }
    // A seat added by hand is still a seat: the balance rule that approve,
    // the member's own RSVP and the waitlist promotion apply holds here too.
    const quotaBlock = await quotaBlockFor(eventId, event, userId)
    if (quotaBlock) return quotaBlock

    await prisma.$transaction(async (tx) => {
      await tx.waitlistEntry.deleteMany({ where: { eventId, userId } })
      await activateAttendee(tx, { userId, eventId, status: 'approved' })
    })
    // Recompute, never a blind decrement: an admin adding to an already-full
    // event used to push spotsLeft negative until the nightly sweep clamped
    // it. Recompute derives from the rows just written and clamps at 0.
    await recomputeSpotsLeft(eventId, event.totalSpots)

    autoJoinClub(userId, eventId).catch(() => {})
    createNotification(userId, 'rsvp', 'You\'re in! 🎉',
      `You've been added to "${event.title}".`, `/events/${eventId}`)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// POST — promote waitlist entry to attendee
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (await overParticipantOpsLimit(session.id)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id: eventId } = await params
    if (!await canManageEventOps(session.id, session.role, eventId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { userId } = await req.json().catch(() => ({}))
    // Prisma drops an undefined filter: without this, an empty body deleted
    // the whole waitlist and revived every cancelled row on the event.
    if (typeof userId !== 'string' || !userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 })
    }

    const eventMeta = await prisma.event.findUnique({
      where: { id: eventId },
      select: { approvalRequired: true, hostId: true, status: true, ...quotaEventSelect },
    })
    if (!eventMeta) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (eventMeta.hostId === userId) return NextResponse.json({ error: 'Hosts are automatically attending their own events' }, { status: 400 })
    if (eventMeta.status === 'cancelled' || eventMeta.status === 'archived') {
      return NextResponse.json({ error: 'Cannot promote into a cancelled or archived event' }, { status: 400 })
    }
    // Promote means "off the waitlist". It skipped every check the add path
    // makes; a member with a live pending row hit the unique key and 500'd.
    const [onWaitlist, existing] = await Promise.all([
      prisma.waitlistEntry.findUnique({ where: { userId_eventId: { userId, eventId } }, select: { id: true } }),
      prisma.eventAttendee.findUnique({ where: { userId_eventId: { userId, eventId } }, select: { status: true } }),
    ])
    if (!onWaitlist) return NextResponse.json({ error: 'Not on the waitlist' }, { status: 404 })
    if (isActiveAttendee(existing)) {
      return NextResponse.json({ error: existing?.status === 'pending' ? 'They already have a pending request — approve it instead' : 'Already attending' }, { status: 409 })
    }

    // Same rule as the PUT add-member path above.
    const gate = await getRsvpGate(userId)
    if (!gate.ok && gate.code === 'red_card_blocked') {
      return NextResponse.json(gateErrorBody(gate), { status: 409 })
    }
    const quotaBlock = await quotaBlockFor(eventId, eventMeta, userId)
    if (quotaBlock) return quotaBlock

    await prisma.$transaction(async (tx) => {
      await tx.waitlistEntry.deleteMany({ where: { eventId, userId } })
      await activateAttendee(tx, { userId, eventId, status: 'approved' })
    })
    // Recompute, never a blind decrement — see the PUT add-attendee path.
    await recomputeSpotsLeft(eventId, eventMeta.totalSpots)
    autoJoinClub(userId, eventId).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
