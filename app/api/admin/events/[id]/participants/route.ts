import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isClubHost } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { sendEventApprovedEmail, sendEventRejectedEmail, recordEmailFailure } from '@/lib/email'
import { autoJoinClub } from '@/lib/autoJoinClub'

import { recomputeSpotsLeft } from '@/lib/spotsLeft'
import { writeAudit } from '@/lib/audit'

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
  reason: 'delete' | 'reject'
  eventTitle?: string | null
}) {
  const { session, userId, eventId, reason, eventTitle } = opts
  const reasonLabel = reason === 'reject' ? 'Admin rejected RSVP' : 'Admin removed attendee'

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
          note:       `${reasonLabel} (₺${p.amount} ${p.currency})`,
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
        note:       `${reasonLabel} — payment still 'paid', refund pending review (₺${p.amount} ${p.currency})`,
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

const userSelect = { id: true, name: true, color: true, email: true, profilePhoto: true, gender: true, nationality: true, phone: true }

async function canManageEvent(sessionId: string, eventId: string, sessionRole: string): Promise<boolean> {
  if (sessionRole === 'admin') return true
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { clubId: true, hostId: true } })
  if (!event) return false
  if (event.hostId === sessionId) return true
  if (!event.clubId) return false
  const membership = await prisma.clubMembership.findFirst({
    where: { userId: sessionId, clubId: event.clubId, role: 'host', status: 'approved' },
  })
  return !!membership
}

export async function GET(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const { id: eventId } = await params
    if (!await canManageEvent(session.id, eventId, session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [attendeesRaw, waitlistRaw, cohosts, eventRow, payments] = await Promise.all([
      prisma.eventAttendee.findMany({
        where: { eventId },
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

    // Keep all in the list for display, but tag host/cohost so client can distinguish
    const attendees = attendeesRaw.map(a => ({
      ...a,
      isStaff: excludeIds.has(a.userId),
    }))

    const waitlistUserIds = waitlistRaw.map(w => w.userId)
    const waitlistUsers = waitlistUserIds.length
      ? await prisma.user.findMany({ where: { id: { in: waitlistUserIds } }, select: userSelect })
      : []
    const userMap = Object.fromEntries(waitlistUsers.map(u => [u.id, u]))
    const waitlist = waitlistRaw.map(w => ({ ...w, user: userMap[w.userId] }))

    return NextResponse.json({ attendees, waitlist, payments })
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
    const { id: eventId } = await params
    if (!await canManageEvent(session.id, eventId, session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { userId, type } = await req.json()

    if (type === 'waitlist') {
      await prisma.waitlistEntry.deleteMany({ where: { eventId, userId } })
      return NextResponse.json({ ok: true })
    }

    const [entry, eventRow] = await Promise.all([
      prisma.eventAttendee.findUnique({ where: { userId_eventId: { userId, eventId } } }),
      prisma.event.findUnique({ where: { id: eventId }, select: { title: true, approvalRequired: true, totalSpots: true } }),
    ])
    await prisma.eventAttendee.deleteMany({ where: { eventId, userId } })

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
      // Promote first person on waitlist, or free the spot
      const next = await prisma.waitlistEntry.findFirst({ where: { eventId }, orderBy: { createdAt: 'asc' } })
      if (next) {
        await prisma.$transaction([
          prisma.waitlistEntry.delete({ where: { id: next.id } }),
          prisma.eventAttendee.create({ data: { userId: next.userId, eventId, status: 'approved' } }),
        ])
        createNotification(next.userId, 'waitlist_promoted', 'Spot available! 🎉',
          `A spot opened up for "${eventRow?.title}" — you're in!`, `/events/${eventId}`)
      }
      if (eventRow?.approvalRequired) {
        await recomputeSpotsLeft(eventId, eventRow.totalSpots)
      } else if (!next) {
        await prisma.event.update({ where: { id: eventId }, data: { spotsLeft: { increment: 1 } } })
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
    const { id: eventId } = await params
    if (!await canManageEvent(session.id, eventId, session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { userId, action } = await req.json() // action: 'approve' | 'reject' | 'markPaid' | 'markUnpaid'

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
                    currency: evt.currency ?? 'TRY', status: 'paid', method: 'manual' },
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

    const [event, user] = await Promise.all([
      prisma.event.findUnique({ where: { id: eventId }, select: { title: true, status: true, spotsLeft: true, date: true, neighborhood: true, turkishMaleQuota: true, genderBalance: true, maleQuota: true, femaleQuota: true, totalSpots: true, approvalRequired: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true, gender: true, nationality: true } }),
    ])

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

    if (action === 'approve' && (event?.status === 'cancelled' || event?.status === 'archived')) {
      return NextResponse.json({ error: 'Cannot approve into a cancelled or archived event' }, { status: 400 })
    }

    if (action === 'approve') {
      // Turkish male quota check
      if (event?.turkishMaleQuota && isMale && isTurkish) {
        const turkishMaleCount = await prisma.eventAttendee.count({
          where: { eventId, status: 'approved', user: { gender: { in: MALE_VARIANTS }, nationality: { in: TURKEY_VARIANTS } } },
        })
        if (turkishMaleCount >= event.turkishMaleQuota) {
          // Move to waitlist instead
          await prisma.eventAttendee.delete({ where: { userId_eventId: { userId, eventId } } })
          await prisma.waitlistEntry.create({ data: { userId, eventId } })
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
          await prisma.eventAttendee.delete({ where: { userId_eventId: { userId, eventId } } })
          await prisma.waitlistEntry.create({ data: { userId, eventId } })
          createNotification(userId, 'waitlist', 'Added to waitlist 📋',
            `Male spots for "${event.title}" are full — you're on the waitlist.`, `/events/${eventId}`)
          return NextResponse.json({ ok: true, status: 'waitlisted', reason: 'male_quota' })
        }
      }

      // Female quota check — mirrors the male side. Only enforced when
      // femaleQuota is explicitly set; null = uncapped female side (old
      // behaviour, preserved by default).
      if (event?.genderBalance && isFemale && event.femaleQuota != null) {
        const femaleCount = await prisma.eventAttendee.count({
          where: { eventId, status: 'approved', user: { gender: { in: FEMALE_VARIANTS } } },
        })
        if (femaleCount >= event.femaleQuota) {
          await prisma.eventAttendee.delete({ where: { userId_eventId: { userId, eventId } } })
          await prisma.waitlistEntry.create({ data: { userId, eventId } })
          createNotification(userId, 'waitlist', 'Added to waitlist 📋',
            `Female spots for "${event.title}" are full — you're on the waitlist.`, `/events/${eventId}`)
          return NextResponse.json({ ok: true, status: 'waitlisted', reason: 'female_quota' })
        }
      }

      await prisma.eventAttendee.update({
        where: { userId_eventId: { userId, eventId } },
        data: { status: 'approved' },
      })
      if (event?.approvalRequired) {
        await recomputeSpotsLeft(eventId, event.totalSpots)
      } else {
        await prisma.event.update({ where: { id: eventId }, data: { spotsLeft: { decrement: 1 } } })
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
    } else if (action === 'reject') {
      await prisma.eventAttendee.delete({ where: { userId_eventId: { userId, eventId } } })
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
    const { id: eventId } = await params
    if (!await canManageEvent(session.id, eventId, session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { title: true, spotsLeft: true, approvalRequired: true, totalSpots: true, hostId: true },
    })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (event.hostId === userId) return NextResponse.json({ error: 'Hosts are automatically attending their own events' }, { status: 400 })

    const existing = await prisma.eventAttendee.findUnique({
      where: { userId_eventId: { userId, eventId } },
    })
    if (existing) return NextResponse.json({ error: 'Already attending' }, { status: 409 })

    await prisma.$transaction([
      prisma.waitlistEntry.deleteMany({ where: { eventId, userId } }),
      prisma.eventAttendee.create({ data: { userId, eventId, status: 'approved' } }),
      ...(event.approvalRequired ? [] : [prisma.event.update({ where: { id: eventId }, data: { spotsLeft: { decrement: 1 } } })]),
    ])
    if (event.approvalRequired) {
      await recomputeSpotsLeft(eventId, event.totalSpots)
    }

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
    const { id: eventId } = await params
    if (!await canManageEvent(session.id, eventId, session.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { userId } = await req.json()

    const eventMeta = await prisma.event.findUnique({
      where: { id: eventId },
      select: { approvalRequired: true, totalSpots: true },
    })

    await prisma.$transaction([
      prisma.waitlistEntry.deleteMany({ where: { eventId, userId } }),
      prisma.eventAttendee.create({ data: { userId, eventId, status: 'approved' } }),
      ...(eventMeta?.approvalRequired ? [] : [prisma.event.update({ where: { id: eventId }, data: { spotsLeft: { decrement: 1 } } })]),
    ])
    if (eventMeta?.approvalRequired) {
      await recomputeSpotsLeft(eventId, eventMeta.totalSpots)
    }
    autoJoinClub(userId, eventId).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
