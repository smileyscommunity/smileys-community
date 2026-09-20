import { NextRequest, NextResponse } from 'next/server'
import { findPromotableFromWaitlist, hasQuotaRoomFor, quotaEventSelect } from '@/lib/eventQuota'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isClubHost, canManageEventOps, hostCityIds } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { sendEventApprovedEmail, sendEventRejectedEmail, recordEmailFailure } from '@/lib/email'
import { autoJoinClub } from '@/lib/autoJoinClub'
import { createSeatPayment } from '@/lib/rsvpConfirmed'

import { recomputeSpotsLeft } from '@/lib/spotsLeft'
import { writeAudit } from '@/lib/audit'
import { activateAttendee, activeAttendeeWhere, cancelAttendeeOp, isActiveAttendee, type CancelActor } from '@/lib/attendance'
import { standingLevelsFor, redCardBlocksSeat } from '@/lib/standingRead'
import { DEFAULT_CURRENCY } from '@/lib/data'
import { rateLimit, claimOnce, releaseClaim } from '@/lib/rateLimit'
import { isBlockedEitherWay } from '@/lib/memberPrivacy'
import { getMemberCityIds } from '@/lib/cityMembership'
import { lockEventRow, seatState, seatVerdict, overCapacityBody, wantsOverCapacity } from '@/lib/eventCapacity'
import { getCityTz } from '@/lib/city'
import { eventHasStarted, eventStartsAt, eventEndsAt } from '@/lib/eventTime'

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

    const [attendeesRaw, waitlistRaw, cohosts, eventRow, payments] = await Promise.all([
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
    ])

    const excludeIds = new Set([
      eventRow?.hostId,
      ...cohosts.map(c => c.userId),
    ].filter(Boolean) as string[])

    // Standing is private to the member everywhere else — hosts never see it
    // on the approved list or the waitlist. The one place it informs a
    // decision is the approval queue, so pending rows, and only those, carry
    // the member's level. A red here means the request predates the
    // restriction, since a red enforces itself at RSVP time.
    const pendingIds = attendeesRaw.filter(a => a.status === 'pending').map(a => a.userId)
    const standingLevels = await standingLevelsFor(pendingIds)

    // Who standing has already told they weren't checked in. The "Notify
    // no-shows" button skips these (same rows, same filter, in that route),
    // so the client needs them to count only who a send would actually
    // reach. This replaces the v1 card list the page used to read for it.
    const warnedRows = await prisma.notification.findMany({
      where:   { type: 'attendance_check', link: { contains: eventId } },
      select:  { userId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    // Keep all in the list for display, but tag host/cohost so client can distinguish
    const attendees = attendeesRaw.map(a => ({
      ...a,
      isStaff: excludeIds.has(a.userId),
      ...(a.status === 'pending' ? { standing: standingLevels.get(a.userId) ?? null } : {}),
    }))

    const waitlistUserIds = waitlistRaw.map(w => w.userId)
    const waitlistUsers = waitlistUserIds.length
      ? await prisma.user.findMany({ where: { id: { in: waitlistUserIds } }, select: userSelect })
      : []
    const userMap = Object.fromEntries(waitlistUsers.map(u => [u.id, u]))
    // waitlist has no FK to users: a deleted member leaves a row with no user,
    // and the page crashed on `w.user.name`. Drop the orphans.
    const waitlist = waitlistRaw.map(w => ({ ...w, user: userMap[w.userId] })).filter(w => w.user != null)

    // Contact details follow the check-in route's rule: admins and the
    // primary host only. Co-hosts and club hosts run the door by name and
    // photo; gender and nationality stay, since balance quotas are theirs to
    // manage.
    // Phone numbers are an admin's alone: the host page never shows them,
    // and a host who could seat anyone and read this list back had every
    // member's number.
    const isAdminViewer = session.role === 'admin'
    // Emails go to the event's host only while they still hold a host role:
    // a club deactivated or a city grant revoked left the former host reading
    // every guest's address on the events they still held.
    const canSeeContact = isAdminViewer || (eventRow?.hostId === session.id && (
      session.role === 'moderator' || await isClubHost(session.id) || (await hostCityIds(session.id)).length > 0))
    const stripContact = <T extends { user?: { email?: unknown; phone?: unknown } | null }>(row: T): T => {
      if (!row.user) return row
      if (isAdminViewer) return row
      const { email, phone: _p, ...user } = row.user
      return { ...row, user: canSeeContact ? { ...user, email } : user } as T
    }

    return NextResponse.json({
      attendees: attendees.map(stripContact),
      waitlist:  waitlist.map(stripContact),
      payments,
      warned:    warnedRows.map(n => ({ userId: n.userId, notifiedAt: n.createdAt })),
    })
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
      prisma.event.findUnique({ where: { id: eventId }, select: { title: true, approvalRequired: true, price: true, payTo: true, currency: true, hostId: true, cityId: true, date: true, time: true, endTime: true, ...quotaEventSelect } }),
    ])
    // Once the event has started a seat is part of the attendance record:
    // removing a guest then took them out of the review (no card), or took
    // an attended guest's credit away. Check-in and Excuse are the tools.
    if (!isAdmin(session) && eventRow && eventHasStarted(eventRow, await getCityTz(eventRow.cityId))) {
      return NextResponse.json({ error: 'It has started — mark them at check-in or excuse them instead' }, { status: 409 })
    }
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
      //
      // Not once the event has started — the member's own cancel already
      // holds back by the same rule. A host removing someone at 20:30 on a
      // 19:00 event seated the first waitlister, who couldn't get there and
      // was carded as a no-show for it. The counter is still re-derived in
      // the lock below; nobody is seated or told a spot opened.
      const started = !!eventRow && eventHasStarted(eventRow, await getCityTz(eventRow.cityId))
      const next = eventRow && !started ? await findPromotableFromWaitlist(eventId, eventRow) : null
      if (eventRow) {
        const promoted = await prisma.$transaction(async (tx) => {
          await lockEventRow(tx, eventId)
          // Removing one seat from an event already over its cap frees nothing:
          // promoting into it kept the event over (12/10 → remove → promote →
          // 12/10). Only a seat that is really free is handed on.
          const seats = next ? await seatState(tx, eventId) : null
          const room  = !!next && (!seats || seatVerdict(seats).ok)
          if (next && room) {
            await tx.waitlistEntry.delete({ where: { id: next.id } })
            await activateAttendee(tx, { userId: next.userId, eventId, status: 'approved', stealth: next.stealth })
            // A promoted seat owes what any seat owes (lib/rsvpConfirmed).
            await createSeatPayment(tx, eventId, eventRow, next.userId)
          }
          // Recompute in every branch, under the lock — the blind increment
          // could creep past totalSpots on repeated remove cycles, and a
          // counter written after commit let a member RSVP read the stale one.
          await recomputeSpotsLeft(eventId, seats?.totalSpots ?? eventRow.totalSpots, tx)
          return room
        })
        if (next && promoted) {
          createNotification(next.userId, 'waitlist_promoted', 'Spot available! 🎉',
            `A spot opened up for "${eventRow?.title}" — you're in!`, `/events/${eventId}`)
        }
      }
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
    const body = await req.json().catch(() => ({}))
    const { userId, action } = body
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
      prisma.event.findUnique({ where: { id: eventId }, select: { title: true, status: true, spotsLeft: true, date: true, time: true, endTime: true, cityId: true, neighborhood: true, turkishMaleQuota: true, genderBalance: true, maleQuota: true, femaleQuota: true, totalSpots: true, approvalRequired: true, price: true, payTo: true, currency: true, hostId: true } }),
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
    // Approving someone already approved (a double-click, a stale tab) has
    // nothing to do. Carried on, it counted them against the cap a second
    // time — 409 and an "exceed capacity?" prompt for a member already seated.
    if (action === 'approve' && current?.status === 'approved') {
      return NextResponse.json({ ok: true })
    }
    // A red-card block holds here as it does for PUT/POST: approving gives a
    // seat, and "to waitlist" gives a place in the queue — neither for a
    // member whose RSVPs are paused. Reject and remove stay open.
    if ((action === 'approve' || action === 'toWaitlist') && await redCardBlocksSeat(userId, eventId)) {
      return NextResponse.json({ error: 'Their standing is paused for events with limited spots. Three check-ins at any event restores it.', code: 'red_card_blocked' }, { status: 409 })
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
    // Moving a seated guest to the waitlist after the start rewrites the
    // attendance record the same way removing them does.
    if (action === 'toWaitlist' && !isAdmin(session) && event &&
        eventHasStarted(event, await getCityTz(event.cityId))) {
      return NextResponse.json({ error: 'It has started — mark them at check-in or excuse them instead' }, { status: 409 })
    }

    if (action === 'approve') {
      // One approval at a time per event, the way the RSVP route seats people:
      // the balance counts and the seat are read and written under a row lock
      // on the event. Bulk approve sent these in parallel, each request counted
      // the same approved seats, and three men approved at once onto the last
      // men's spot all got in.
      const WAITLIST_NOTE = { turkish_male_quota: 'Turkish male spots', male_quota: 'Male spots', female_quota: 'Female spots' } as const
      let capacity: { approved: number; totalSpots: number } | null = null
      const quotaFull = await prisma.$transaction(async tx => {
        await lockEventRow(tx, eventId)
        // Read again under the lock: two clicks sent together both saw
        // 'pending' above, and the second would count the first's seat
        // against its own approval — or trip a balance quota and waitlist a
        // member who was just seated.
        const now = await tx.eventAttendee.findUnique({ where: { userId_eventId: { userId, eventId } }, select: { status: true } })
        if (now?.status === 'approved') return 'already_approved' as const
        let full: keyof typeof WAITLIST_NOTE | 'over_capacity' | null = null
        if (event?.turkishMaleQuota && isMale && isTurkish) {
          const n = await tx.eventAttendee.count({
            where: { eventId, status: 'approved', user: { gender: { in: MALE_VARIANTS }, nationality: { in: TURKEY_VARIANTS } } },
          })
          if (n >= event.turkishMaleQuota) full = 'turkish_male_quota'
        }
        if (!full && event?.genderBalance && isMale) {
          const n = await tx.eventAttendee.count({
            where: { eventId, status: 'approved', user: { gender: { in: MALE_VARIANTS } } },
          })
          if (n >= (event.maleQuota ?? Math.floor(event.totalSpots / 2))) full = 'male_quota'
        }
        // Female side mirrors the male side, fallback included: a null
        // femaleQuota used to mean uncapped.
        if (!full && event?.genderBalance && isFemale) {
          const n = await tx.eventAttendee.count({
            where: { eventId, status: 'approved', user: { gender: { in: FEMALE_VARIANTS } } },
          })
          if (n >= (event.femaleQuota ?? Math.floor(event.totalSpots / 2))) full = 'female_quota'
        }
        if (full) {
          // Onto the waitlist instead, in the same transaction. Upsert: they
          // may already sit on the waitlist from an earlier round, and a plain
          // create threw after the seat was already given up.
          await cancelAttendeeOp(tx, { userId, eventId, by: cancelActor(session) })
          await tx.waitlistEntry.upsert({
            where:  { userId_eventId: { userId, eventId } },
            create: { userId, eventId },
            update: {},
          })
          return full
        }
        // The cap, counted under the lock. Approving had no seat check at all —
        // the balance rules above were the only limit. Refused unless the page
        // confirmed going over (lib/admin/overCapacity); a co-host takes no seat.
        const seats = await seatState(tx, eventId)
        const verdict = seats && !seats.staffIds.includes(userId) ? seatVerdict(seats) : { ok: true as const }
        if (!verdict.ok && !wantsOverCapacity(body)) {
          capacity = verdict
          return 'over_capacity'
        }
        // The seat dates from now, not from the request: standing's "a seat
        // taken inside the last hours never counts" reads joinedAt, and a
        // request approved an hour before the start is such a seat.
        await tx.eventAttendee.update({
          where: { userId_eventId: { userId, eventId } },
          data: { status: 'approved', joinedAt: new Date() },
        })
        // Approval relied on the row written at request time, which can be
        // gone by now (moved to the waitlist and back, collection switched on
        // after they asked) — the seat then owed nothing. A surviving row is
        // left as it is (lib/rsvpConfirmed).
        if (event) await createSeatPayment(tx, eventId, event, userId)
        // Recompute, never a blind decrement, and inside the lock: written
        // after commit, a member's RSVP could still read the old counter and
        // take the seat this approval just filled.
        if (event) await recomputeSpotsLeft(eventId, seats?.totalSpots ?? event.totalSpots, tx)
        return null
      })
      if (quotaFull === 'already_approved') return NextResponse.json({ ok: true })
      if (quotaFull === 'over_capacity') {
        return NextResponse.json(overCapacityBody(capacity!), { status: 409 })
      }
      if (quotaFull) {
        createNotification(userId, 'waitlist', 'Added to waitlist 📋',
          `${WAITLIST_NOTE[quotaFull]} for "${event?.title}" are full — you're on the waitlist.`, `/events/${eventId}`)
        return NextResponse.json({ ok: true, status: 'waitlisted', reason: quotaFull })
      }

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
      // Rejecting an approved attendee frees their seat, and spotsLeft kept
      // counting it taken. Recounted under the event lock like every other
      // seat change, so an RSVP can't read the counter in between.
      await prisma.$transaction(async tx => {
        await lockEventRow(tx, eventId)
        await cancelAttendeeOp(tx, { userId, eventId, by: cancelActor(session) })
        if (event) {
          const seats = await seatState(tx, eventId)
          await recomputeSpotsLeft(eventId, seats?.totalSpots ?? event.totalSpots, tx)
        }
      })
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

// PUT — add a member. An admin seats them directly; anyone else running the
// event (host, co-host, club or city host, moderator) sends an INVITATION the
// member accepts by RSVPing themselves — or, at the door (`walkIn`, from an
// hour before the start to the end), seats someone who turned up. Seating by hand let a host put any
// member on any event — then read their contact details back off the list,
// or run close-out and hand them a no-show for an event they never joined.
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
    const body = await req.json().catch(() => ({}))
    const { userId } = body
    if (typeof userId !== 'string' || !userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { title: true, spotsLeft: true, approvalRequired: true, hostId: true, status: true, price: true, payTo: true, currency: true, cityId: true, date: true, time: true, endTime: true, ...quotaEventSelect },
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

    // Only a live member, and not one who blocked the caller or was blocked.
    const target = await prisma.user.findUnique({
      where:  { id: userId },
      select: { status: true, suspendedUntil: true, hiddenFromMembers: true, cityId: true },
    })
    if (!target || target.status !== 'approved' || (target.suspendedUntil && target.suspendedUntil > new Date())) {
      return NextResponse.json({ error: 'That member can\'t be added' }, { status: 404 })
    }

    // A walk-in: someone standing at the door, seated by whoever runs it.
    // Only from an hour before the start until the end (in the event's city),
    // and bounded per event — the door can't be used to seat people remotely.
    const tz     = await getCityTz(event.cityId)
    const now    = Date.now()
    const walkIn = body.walkIn === true &&
      now >= eventStartsAt(event, tz).getTime() - 60 * 60_000 && now <= eventEndsAt(event, tz).getTime()

    if (!isAdmin(session)) {
      // Invited or walked in, the same member rules: a hidden member, a
      // blocked pair and a member of another city look the same as "not found".
      if (target.hiddenFromMembers || await isBlockedEitherWay(session.id, userId)) {
        return NextResponse.json({ error: 'That member can\'t be added' }, { status: 404 })
      }
      const memberCities = await getMemberCityIds(userId)
      if (!memberCities.includes(event.cityId) && target.cityId !== event.cityId) {
        return NextResponse.json({ error: 'That member can\'t be added' }, { status: 404 })
      }
    }
    if (!isAdmin(session) && body.walkIn === true && !walkIn) {
      return NextResponse.json({ error: 'Walk-ins are added at the door — from an hour before the start until the end' }, { status: 409 })
    }
    if (!isAdmin(session) && walkIn && event.status !== 'published' && event.status !== 'postponed') {
      return NextResponse.json({ error: 'This event isn\'t live — there\'s no door to add walk-ins at' }, { status: 409 })
    }
    if (!isAdmin(session) && walkIn && !await rateLimit(`walk-in:${eventId}`, 30, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many walk-ins added — ask an admin' }, { status: 429 })
    }

    if (!isAdmin(session) && !walkIn) {
      // An invitation once it's too late to RSVP is a dead end.
      if (eventHasStarted(event, tz)) {
        return NextResponse.json({ error: 'It has started — add them as a walk-in at the door' }, { status: 409 })
      }
      // An invitation to a page they can open: the event has to be live.
      if (event.status !== 'published' && event.status !== 'postponed') {
        return NextResponse.json({ error: 'You can invite people once the event is live' }, { status: 409 })
      }
      // One invitation per member per event, however often it's pressed.
      const inviteKey = `event-invite:${eventId}:${userId}`
      if (!await claimOnce(inviteKey, 30 * 24 * 60 * 60_000)) {
        return NextResponse.json({ error: 'They\'ve already been invited' }, { status: 409 })
      }
      const delivered = await createNotification(userId, 'rsvp', 'You\'re invited 🎟️',
        `${session.name.split(' ')[0]} invited you to "${event.title}". Tap to take a spot.`, `/events/${eventId}`)
      if (!delivered) {
        await releaseClaim(inviteKey)
        return NextResponse.json({ error: 'Could not send the invitation — try again' }, { status: 502 })
      }
      writeAudit(session.id, session.name, 'event.invite', eventId, 'event', { userId }, `Invited a member to "${event.title}"`)
      return NextResponse.json({ ok: true, invited: true })
    }

    // A red-card block holds for a host's manual add too — otherwise it is
    // a rule for one button only. (A yellow card's confirmation is the
    // member's own promise, not something a host makes for them.)
    if (await redCardBlocksSeat(userId, eventId)) {
      return NextResponse.json({ error: 'Their standing is paused for events with limited spots. Three check-ins at any event restores it.', code: 'red_card_blocked' }, { status: 409 })
    }
    // A seat added by hand is still a seat: the balance rule that approve,
    // the member's own RSVP and the waitlist promotion apply holds here too.
    const quotaBlock = await quotaBlockFor(eventId, event, userId)
    if (quotaBlock) return quotaBlock

    // A seat added by hand is a seat against the cap too — counted under the
    // lock, refused past it unless the page confirmed (lib/eventCapacity).
    const added = await prisma.$transaction(async (tx) => {
      await lockEventRow(tx, eventId)
      const seats = await seatState(tx, eventId)
      const verdict = seats && !seats.staffIds.includes(userId) ? seatVerdict(seats) : { ok: true as const }
      if (!verdict.ok && !wantsOverCapacity(body)) return verdict
      // A stealth waitlister stays stealth when seated by hand.
      const queued = await tx.waitlistEntry.findUnique({ where: { userId_eventId: { userId, eventId } }, select: { stealth: true } })
      await tx.waitlistEntry.deleteMany({ where: { eventId, userId } })
      await activateAttendee(tx, { userId, eventId, status: 'approved', stealth: queued?.stealth ?? false })
      // A seat added by hand owed nothing on the ledger; it owes what a
      // member's own RSVP owes (lib/rsvpConfirmed).
      await createSeatPayment(tx, eventId, event, userId)
      // Recompute, never a blind decrement — and under the lock, so a member
      // RSVP can't take this seat again off the old counter.
      await recomputeSpotsLeft(eventId, seats?.totalSpots ?? event.totalSpots, tx)
      return { ok: true as const }
    })
    if (!added.ok) return NextResponse.json(overCapacityBody(added), { status: 409 })

    autoJoinClub(userId, eventId).catch(() => {})
    createNotification(userId, 'rsvp', 'You\'re in! 🎉',
      `You've been added to "${event.title}".`, `/events/${eventId}`)
    writeAudit(session.id, session.name, walkIn ? 'event.walk_in' : 'event.seat_add', eventId, 'event', { userId },
      `${walkIn ? 'Seated a walk-in at' : 'Seated a member on'} "${event.title}"`)

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
    const body = await req.json().catch(() => ({}))
    const { userId } = body
    // Prisma drops an undefined filter: without this, an empty body deleted
    // the whole waitlist and revived every cancelled row on the event.
    if (typeof userId !== 'string' || !userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 })
    }

    const eventMeta = await prisma.event.findUnique({
      where: { id: eventId },
      select: { approvalRequired: true, hostId: true, status: true, price: true, payTo: true, currency: true, ...quotaEventSelect },
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
    if (await redCardBlocksSeat(userId, eventId)) {
      return NextResponse.json({ error: 'Their standing is paused for events with limited spots. Three check-ins at any event restores it.', code: 'red_card_blocked' }, { status: 409 })
    }
    const quotaBlock = await quotaBlockFor(eventId, eventMeta, userId)
    if (quotaBlock) return quotaBlock

    // Same cap rule as the add above: a promotion is a seat.
    const promoted = await prisma.$transaction(async (tx) => {
      await lockEventRow(tx, eventId)
      const seats = await seatState(tx, eventId)
      const verdict = seats && !seats.staffIds.includes(userId) ? seatVerdict(seats) : { ok: true as const }
      if (!verdict.ok && !wantsOverCapacity(body)) return verdict
      // A stealth waitlister stays stealth when promoted.
      const queued = await tx.waitlistEntry.findUnique({ where: { userId_eventId: { userId, eventId } }, select: { stealth: true } })
      await tx.waitlistEntry.deleteMany({ where: { eventId, userId } })
      await activateAttendee(tx, { userId, eventId, status: 'approved', stealth: queued?.stealth ?? false })
      // Same ledger row as the add above.
      await createSeatPayment(tx, eventId, eventMeta, userId)
      // Recompute, never a blind decrement — see the PUT add-attendee path.
      await recomputeSpotsLeft(eventId, seats?.totalSpots ?? eventMeta.totalSpots, tx)
      return { ok: true as const }
    })
    if (!promoted.ok) return NextResponse.json(overCapacityBody(promoted), { status: 409 })
    autoJoinClub(userId, eventId).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
