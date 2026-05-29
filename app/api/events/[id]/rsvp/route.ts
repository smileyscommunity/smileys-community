import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'
import { createNotification } from '@/lib/notify'
import { getAvailableSpots } from '@/lib/db'
import { sendRsvpConfirmationEmail, sendWaitlistPromotedEmail } from '@/lib/email'
import { recomputeSpotsLeft } from '@/lib/spotsLeft'
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

    // Normalize gender / nationality so 'Male', 'MALE', 'male' all compare
    // equal and 'Türkiye' / 'Turkey' / 'TR' don't accidentally bypass the
    // Turkish-male sub-quota. Cheap, applies at compare time so existing
    // dirty data doesn't need a backfill.
    const userGender      = (userRecord?.gender      ?? '').trim().toLowerCase()
    const userNationality = (userRecord?.nationality ?? '').trim().toLowerCase()
    const TURKISH_VALUES = new Set(['turkey', 'türkiye', 'turkiye', 'tr', 'turkish'])
    const isMale         = userGender === 'male'
    const isFemale       = userGender === 'female'
    const isTurkish      = TURKISH_VALUES.has(userNationality)

    // Gender-balanced events require gender to be set
    if (event.genderBalance && !userGender) {
      return NextResponse.json({
        error: 'This event uses gender balance. Please set your gender in your profile settings before joining.',
      }, { status: 400 })
    }

    // Approval-required events create a 'pending' attendee instead of
    // auto-approving — that's the whole point of the flag. spotsLeft is NOT
    // decremented until the host/admin approves; the participants page
    // handles that. The capacity check below treats pending RSVPs as
    // soft holds so two concurrent requests can't both claim the last slot.
    if (event.approvalRequired) {
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
      // Create as pending — host approves from the participants page.
      await prisma.eventAttendee.create({
        data: { userId: session.id, eventId, status: 'pending', stealth },
      })
      createNotification(session.id, 'rsvp_pending', 'RSVP submitted ⏳',
        `Your request to join "${event.title}" is waiting on the host. You'll be notified once it's reviewed.`,
        `/events/${eventId}`)
      if (event.hostId) {
        createNotification(event.hostId, 'attendee_joined', 'New RSVP awaiting approval ⏳',
          `Someone just requested to join "${event.title}".`,
          `/host/events/${eventId}/participants`)
      }
      return NextResponse.json({ ok: true, status: 'pending' })
    }

    // Auto-approve path. Quota + spot checks happen in one transaction with
    // a row-level lock on the event, so concurrent RSVPs serialize and can't
    // both pass a quota at the boundary (e.g. two males both claiming the
    // last male slot).
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`

      if (event.genderBalance && isMale) {
        const maleQuota = event.maleQuota ?? Math.floor(event.totalSpots / 2)
        const maleCount = await tx.eventAttendee.count({
          where: { eventId, status: 'approved', user: { gender: { in: ['male', 'Male', 'MALE'] } } },
        })
        if (maleCount >= maleQuota) return { kind: 'gender_full' as const }
      }

      // Female-side cap — mirrors the male check. Only enforced when
      // femaleQuota is explicitly set (event.femaleQuota null = uncapped).
      // Without this, an all-female RSVP wave could fill 100% of spots and
      // shut males out entirely.
      if (event.genderBalance && isFemale && event.femaleQuota != null) {
        const femaleCount = await tx.eventAttendee.count({
          where: { eventId, status: 'approved', user: { gender: { in: ['female', 'Female', 'FEMALE'] } } },
        })
        if (femaleCount >= event.femaleQuota) return { kind: 'female_full' as const }
      }

      if (event.turkishMaleQuota && isMale && isTurkish) {
        const turkishMaleCount = await tx.eventAttendee.count({
          where: { eventId, status: 'approved',
            user: { gender: { in: ['male', 'Male', 'MALE'] }, nationality: { in: ['Turkey', 'turkey', 'Türkiye', 'türkiye', 'Turkiye', 'TR'] } } },
        })
        if (turkishMaleCount >= event.turkishMaleQuota) return { kind: 'turkish_full' as const }
      }

      const claimed = await tx.event.updateMany({
        where: { id: eventId, spotsLeft: { gt: 0 } },
        data:  { spotsLeft: { decrement: 1 } },
      })
      if (claimed.count === 0) return { kind: 'full' as const }

      await tx.eventAttendee.create({ data: { userId: session.id, eventId, status: 'approved', stealth } })

      if (event.price > 0) {
        await tx.payment.create({
          data: { userId: session.id, eventId, amount: event.price, currency: event.currency ?? 'TRY', status: 'pending' },
        })
      }
      return { kind: 'approved' as const }
    })

    if (outcome.kind !== 'approved') {
      await prisma.waitlistEntry.create({ data: { userId: session.id, eventId } })
      const position = await prisma.waitlistEntry.count({ where: { eventId } })
      const reason =
        outcome.kind === 'gender_full'  ? `Male spots for "${event.title}" are full` :
        outcome.kind === 'female_full'  ? `Female spots for "${event.title}" are full` :
        outcome.kind === 'turkish_full' ? `Turkish male spots for "${event.title}" are full` :
                                          `"${event.title}" is full`
      createNotification(session.id, 'waitlist', 'Added to waitlist 📋',
        `${reason} — you're #${position} on the waitlist.`,
        `/events/${eventId}`)
      return NextResponse.json({ ok: true, status: 'waitlisted', position })
    }

    autoJoinClub(session.id, eventId).catch(() => {})

    createNotification(session.id, 'rsvp', 'You\'re in! 🎉', `Your spot for "${event.title}" is confirmed.`, `/events/${eventId}`)

    // Confirmation email + host notification (fire-and-forget)
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
      if (event.hostId) {
        createNotification(
          event.hostId,
          'attendee_joined',
          'New RSVP 🎉',
          `${user?.name ?? 'A member'} just signed up for "${event.title}"`,
          `/host/events/${eventId}/participants`,
        )
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
      prisma.event.findUnique({ where: { id: eventId }, select: { title: true, approvalRequired: true, totalSpots: true } }),
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
    }
    if (wasApproved) {
      if (eventRow?.approvalRequired) {
        await recomputeSpotsLeft(eventId, eventRow.totalSpots)
      } else if (!next) {
        // No waitlist — free the spot
        await prisma.event.update({ where: { id: eventId }, data: { spotsLeft: { increment: 1 } } })
      }
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
