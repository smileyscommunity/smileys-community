import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
import { getAvailableSpots } from '@/lib/db'
import { sendRsvpConfirmationEmail, sendWaitlistPromotedEmail } from '@/lib/email'
import { autoJoinClub } from '@/lib/autoJoinClub'
import { sendPushToUser } from '@/lib/push'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    if (!await rateLimit(`rsvp:${session.id}`, 5, 60_000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { id: eventId } = await params

    const body = await req.json().catch(() => ({}))
    const stealth = body?.stealth === true

    const [event, userRecord] = await Promise.all([
      prisma.event.findUnique({ where: { id: eventId } }),
      prisma.user.findUnique({ where: { id: session.id }, select: { status: true, gender: true, nationality: true } }),
    ])
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (event.hostId === session.id) {
      return NextResponse.json({ error: 'Hosts cannot join their own event' }, { status: 400 })
    }
    if (userRecord?.status === 'banned') {
      return NextResponse.json({ error: 'Your account has been suspended' }, { status: 403 })
    }

    // Co-hosts attend for free — no spot consumed, no quotas applied
    const isCoHost = !!(await prisma.eventCoHost.findFirst({
      where: { eventId, userId: session.id },
    }))
    if (isCoHost) {
      const existing = await prisma.eventAttendee.findUnique({
        where: { userId_eventId: { userId: session.id, eventId } },
      })
      if (existing) return NextResponse.json({ error: 'Already joined' }, { status: 400 })
      await prisma.eventAttendee.create({ data: { userId: session.id, eventId, status: 'approved', stealth } })
      autoJoinClub(session.id, eventId).catch(() => {})
      createNotification(session.id, 'rsvp', 'You\'re in! 🎉', `Your spot for "${event.title}" is confirmed.`, `/events/${eventId}`)
      return NextResponse.json({ ok: true, status: 'approved' })
    }

    // Check if already attending or pending
    const existing = await prisma.eventAttendee.findUnique({
      where: { userId_eventId: { userId: session.id, eventId } },
    })
    if (existing) return NextResponse.json({ error: 'Already joined' }, { status: 400 })

    // Check if already on waitlist
    const onWaitlist = await prisma.waitlistEntry.findUnique({
      where: { userId_eventId: { userId: session.id, eventId } },
    })
    if (onWaitlist) return NextResponse.json({ error: 'Already on waitlist' }, { status: 400 })

    // Gender-balanced events require gender to be set
    if (event.genderBalance && !userRecord?.gender) {
      return NextResponse.json({
        error: 'This event uses gender balance. Please set your gender in your profile settings before joining.',
      }, { status: 400 })
    }

    if (event.approvalRequired) {
      // Check if pending + approved requests are already at capacity
      const [approvedCount, pendingCount] = await Promise.all([
        prisma.eventAttendee.count({ where: { eventId, status: 'approved' } }),
        prisma.eventAttendee.count({ where: { eventId, status: 'pending' } }),
      ])
      if (approvedCount + pendingCount >= event.totalSpots) {
        await prisma.waitlistEntry.create({ data: { userId: session.id, eventId } })
        const position = await prisma.waitlistEntry.count({ where: { eventId } })
        createNotification(session.id, 'waitlist', 'Added to waitlist 📋',
          `"${event.title}" has no open request slots right now — you're #${position} on the waitlist.`,
          `/events/${eventId}`)
        return NextResponse.json({ ok: true, status: 'waitlisted', position })
      }

      // Gender quota check for approval-required events
      if (event.genderBalance && userRecord?.gender === 'male') {
        const maleQuota = event.maleQuota ?? Math.floor(event.totalSpots / 2)
        const maleCount = await prisma.eventAttendee.count({
          where: { eventId, status: 'approved', user: { gender: 'male' } },
        })
        if (maleCount >= maleQuota) {
          await prisma.waitlistEntry.create({ data: { userId: session.id, eventId } })
          const position = await prisma.waitlistEntry.count({ where: { eventId } })
          createNotification(session.id, 'waitlist', 'Added to waitlist 📋',
            `Male spots for "${event.title}" are full — you're #${position} on the waitlist.`,
            `/events/${eventId}`)
          return NextResponse.json({ ok: true, status: 'waitlisted', position })
        }
      }

      // Turkish male quota check
      if (event.turkishMaleQuota && userRecord?.gender === 'male' && userRecord?.nationality === 'Turkey') {
        const turkishMaleCount = await prisma.eventAttendee.count({
          where: { eventId, status: 'approved', user: { gender: 'male', nationality: 'Turkey' } },
        })
        if (turkishMaleCount >= event.turkishMaleQuota) {
          await prisma.waitlistEntry.create({ data: { userId: session.id, eventId } })
          const position = await prisma.waitlistEntry.count({ where: { eventId } })
          createNotification(session.id, 'waitlist', 'Added to waitlist 📋',
            `Turkish male spots for "${event.title}" are full — you're #${position} on the waitlist.`,
            `/events/${eventId}`)
          return NextResponse.json({ ok: true, status: 'waitlisted', position })
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.eventAttendee.create({ data: { userId: session.id, eventId, status: 'pending' } })
        if (event.price > 0) {
          await tx.payment.create({
            data: { userId: session.id, eventId, amount: event.price, currency: event.currency ?? 'TRY', status: 'pending' },
          })
        }
      })

      createNotification(session.id, 'rsvp_pending', 'Request submitted ⏳', `Your request for "${event.title}" is under review — you'll hear back soon.`, `/events/${eventId}`)

      const joiner = await prisma.user.findUnique({ where: { id: session.id }, select: { name: true } })
      const joinerName = joiner?.name ?? 'A member'
      const notifTitle = 'New join request 🙌'
      const notifBody  = `${joinerName} requested to join "${event.title}"`
      const notifLink  = `/admin/events/${eventId}/participants`

      // Notify Primary Host, Co-hosts and Admins
      const cohosts = await prisma.eventCoHost.findMany({ where: { eventId }, select: { userId: true } })
      const recipientIds = new Set<string>()
      
      if (event.hostId && event.hostId !== session.id) recipientIds.add(event.hostId)
      cohosts.forEach(ch => { if (ch.userId !== session.id) recipientIds.add(ch.userId) })
      
      const staff = await prisma.user.findMany({ where: { role: { in: ['admin', 'moderator'] } }, select: { id: true } })
      staff.forEach(s => { if (s.id !== session.id) recipientIds.add(s.id) })

      await Promise.all(
        Array.from(recipientIds).map(uid => createNotification(uid, 'attendee_joined', notifTitle, notifBody, notifLink))
      )

      return NextResponse.json({ ok: true, status: 'pending' })
    }

    // Gender quota check (before claiming a spot)
    if (event.genderBalance && userRecord?.gender === 'male') {
      const maleQuota = event.maleQuota ?? Math.floor(event.totalSpots / 2)
      const maleCount = await prisma.eventAttendee.count({
        where: { eventId, status: 'approved', user: { gender: 'male' } },
      })
      if (maleCount >= maleQuota) {
        await prisma.waitlistEntry.create({ data: { userId: session.id, eventId } })
        const position = await prisma.waitlistEntry.count({ where: { eventId } })
        createNotification(session.id, 'waitlist', 'Added to waitlist 📋',
          `Male spots for "${event.title}" are full — you're #${position} on the waitlist.`,
          `/events/${eventId}`)
        return NextResponse.json({ ok: true, status: 'waitlisted', position })
      }
    }

    // Turkish male quota check (direct RSVP path)
    if (event.turkishMaleQuota && userRecord?.gender === 'male' && userRecord?.nationality === 'Turkey') {
      const turkishMaleCount = await prisma.eventAttendee.count({
        where: { eventId, status: 'approved', user: { gender: 'male', nationality: 'Turkey' } },
      })
      if (turkishMaleCount >= event.turkishMaleQuota) {
        await prisma.waitlistEntry.create({ data: { userId: session.id, eventId } })
        const position = await prisma.waitlistEntry.count({ where: { eventId } })
        createNotification(session.id, 'waitlist', 'Added to waitlist 📋',
          `Turkish male spots for "${event.title}" are full — you're #${position} on the waitlist.`,
          `/events/${eventId}`)
        return NextResponse.json({ ok: true, status: 'waitlisted', position })
      }
    }

    // Atomically claim a spot + create attendee + create payment in one transaction
    const joined = await prisma.$transaction(async (tx) => {
      const claimed = await tx.event.updateMany({
        where: { id: eventId, spotsLeft: { gt: 0 } },
        data:  { spotsLeft: { decrement: 1 } },
      })
      if (claimed.count === 0) return null

      await tx.eventAttendee.create({ data: { userId: session.id, eventId, status: 'approved' } })

      if (event.price > 0) {
        await tx.payment.create({
          data: { userId: session.id, eventId, amount: event.price, currency: event.currency ?? 'TRY', status: 'pending' },
        })
      }
      return true
    })

    if (!joined) {
      // No spot available — add to waitlist
      await prisma.waitlistEntry.create({ data: { userId: session.id, eventId } })
      const position = await prisma.waitlistEntry.count({ where: { eventId } })
      createNotification(session.id, 'waitlist', 'Added to waitlist 📋',
        `"${event.title}" is full — you're #${position} on the waitlist.`,
        `/events/${eventId}`)
      return NextResponse.json({ ok: true, status: 'waitlisted', position })
    }

    autoJoinClub(session.id, eventId).catch(() => {})

    createNotification(session.id, 'rsvp', 'You\'re in! 🎉', `Your spot for "${event.title}" is confirmed.`, `/events/${eventId}`)

    // Confirmation email (fire-and-forget)
    ;(async () => {
      const user = await prisma.user.findUnique({ where: { id: session.id }, select: { email: true, name: true } })
      if (user) {
        sendRsvpConfirmationEmail(
          user.email, user.name ?? 'Member',
          event.title, event.date,
          event.location ?? event.neighborhood ?? 'Istanbul',
          eventId,
        ).catch(() => {})
      }
    })()

    return NextResponse.json({ ok: true, status: 'approved' })

  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    if (!await rateLimit(`rsvp-cancel:${session.id}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Too many cancellations' }, { status: 429 })
    }

    const { id: eventId } = await params

    // Check if on waitlist first
    const onWaitlist = await prisma.waitlistEntry.findUnique({
      where: { userId_eventId: { userId: session.id, eventId } },
    })
    if (onWaitlist) {
      await prisma.waitlistEntry.delete({
        where: { userId_eventId: { userId: session.id, eventId } },
      })
      return NextResponse.json({ ok: true })
    }

    const existing = await prisma.eventAttendee.findUnique({
      where: { userId_eventId: { userId: session.id, eventId } },
    })
    if (!existing) return NextResponse.json({ error: 'Not attending' }, { status: 400 })

    const wasApproved = existing.status === 'approved'

    await prisma.$transaction([
      prisma.eventAttendee.delete({ where: { userId_eventId: { userId: session.id, eventId } } }),
      // Void any pending payment so no orphaned records remain
      prisma.payment.updateMany({
        where: { userId: session.id, eventId, status: 'pending' },
        data: { status: 'cancelled' },
      }),
    ])

    // Promote first person on waitlist (spot stays filled — no net change to spotsLeft)
    const [next, eventRow] = await Promise.all([
      wasApproved ? prisma.waitlistEntry.findFirst({ where: { eventId }, orderBy: { createdAt: 'asc' } }) : Promise.resolve(null),
      prisma.event.findUnique({ where: { id: eventId }, select: { title: true } }),
    ])
    if (next) {
      await prisma.$transaction([
        prisma.waitlistEntry.delete({ where: { id: next.id } }),
        prisma.eventAttendee.create({ data: { userId: next.userId, eventId, status: 'approved' } }),
      ])
      autoJoinClub(next.userId, eventId).catch(() => {})
      createNotification(next.userId, 'waitlist_promoted', 'Spot available! 🎉', `A spot opened up for "${eventRow?.title}" — you're in!`, `/events/${eventId}`)
      sendPushToUser(next.userId, { title: 'Spot available! 🎉', body: `A spot opened up for "${eventRow?.title}" — you're in!`, link: `/app/events/${eventId}` }).catch(() => {})
      // Email the promoted member (fire-and-forget)
      ;(async () => {
        const promoted = await prisma.user.findUnique({ where: { id: next.userId }, select: { email: true, name: true } })
        if (promoted && eventRow?.title) {
          const ev = await prisma.event.findUnique({ where: { id: eventId }, select: { date: true } })
          sendWaitlistPromotedEmail(promoted.email, promoted.name ?? 'Member', eventRow.title, ev?.date ?? '', eventId).catch(() => {})
        }
      })()
    } else if (wasApproved) {
      // No waitlist — free the spot
      await prisma.event.update({ where: { id: eventId }, data: { spotsLeft: { increment: 1 } } })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function GET(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ attending: false, waitlisted: false })

    const { id: eventId } = await params

    const [attendee, waitlistEntry] = await Promise.all([
      prisma.eventAttendee.findUnique({ where: { userId_eventId: { userId: session.id, eventId } } }),
      prisma.waitlistEntry.findUnique({ where: { userId_eventId: { userId: session.id, eventId } } }),
    ])

    let position: number | null = null
    if (waitlistEntry) {
      position = await prisma.waitlistEntry.count({
        where: { eventId, createdAt: { lte: waitlistEntry.createdAt } },
      })
    }

    return NextResponse.json({
      attending:  attendee?.status === 'approved',
      pending:    attendee?.status === 'pending',
      waitlisted: !!waitlistEntry,
      position,
    })
  } catch (e) {
    return NextResponse.json({ attending: false, waitlisted: false })
  }
}
