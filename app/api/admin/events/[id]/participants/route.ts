import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isClubHost } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { sendEventApprovedEmail, sendEventRejectedEmail } from '@/lib/email'
import { autoJoinClub } from '@/lib/autoJoinClub'
import { sendPushToUser } from '@/lib/push'
import { recomputeSpotsLeft } from '@/lib/spotsLeft'

type Params = { params: Promise<{ id: string }> }

const userSelect = { id: true, name: true, color: true, email: true, profilePhoto: true, gender: true, nationality: true, phone: true }

async function canManageEvent(sessionId: string, eventId: string, sessionRole: string): Promise<boolean> {
  if (sessionRole === 'admin') return true
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { clubId: true, hostId: true } })
  if (!event) return false
  if (event.hostId === sessionId) return true
  const cohost = await prisma.eventCoHost.findUnique({ where: { eventId_userId: { eventId, userId: sessionId } } })
  if (cohost) return true
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

    const [attendeesRaw, waitlistRaw, cohosts, eventRow] = await Promise.all([
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

    return NextResponse.json({ attendees, waitlist })
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
        sendPushToUser(next.userId, { title: 'Spot available! 🎉', body: `A spot opened up for "${eventRow?.title}" — you're in!`, link: `/app/events/${eventId}` }).catch(() => {})
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
    const { userId, action } = await req.json() // action: 'approve' | 'reject'

    const [event, user] = await Promise.all([
      prisma.event.findUnique({ where: { id: eventId }, select: { title: true, spotsLeft: true, date: true, neighborhood: true, turkishMaleQuota: true, genderBalance: true, maleQuota: true, femaleQuota: true, totalSpots: true, approvalRequired: true } }),
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
        sendEventApprovedEmail(user.email, user.name, event.title, event.date, event.neighborhood ?? '', eventId).catch(() => {})
      }
    } else if (action === 'reject') {
      await prisma.eventAttendee.delete({ where: { userId_eventId: { userId, eventId } } })
      createNotification(userId, 'rsvp_pending', 'Request not approved', `Unfortunately your request for "${event?.title}" was not approved this time.`, `/events/${eventId}`)
      if (user?.email && event) {
        sendEventRejectedEmail(user.email, user.name, event.title).catch(() => {})
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
      select: { title: true, spotsLeft: true, approvalRequired: true, totalSpots: true },
    })
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

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
