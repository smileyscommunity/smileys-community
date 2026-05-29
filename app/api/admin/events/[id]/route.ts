import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator, isClubHost, isClubHostFor } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { writeAudit, getDiff } from '@/lib/audit'
import { sendEventCancelledEmail } from '@/lib/email'

type Params = { params: Promise<{ id: string }> }

export async function DELETE(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const admin    = isAdminOrModerator(session)
    const clubHost = !admin && await isClubHost(session.id)
    if (!admin && !clubHost) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params

    if (clubHost) {
      const event = await prisma.event.findUnique({ where: { id }, select: { hostId: true } })
      if (!event || event.hostId !== session.id) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    await prisma.$transaction([
      prisma.eventAttendee.deleteMany({ where: { eventId: id } }),
      prisma.waitlistEntry.deleteMany({ where: { eventId: id } }),
      prisma.review.deleteMany({ where: { eventId: id } }),
      prisma.event.delete({ where: { id } }),
    ])
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const admin    = isAdminOrModerator(session)
    const clubHost = !admin && await isClubHost(session.id)
    if (!admin && !clubHost) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await params

    const before = await prisma.event.findUnique({
      where: { id },
      select: {
        hostId: true, clubId: true, date: true, time: true, location: true, title: true,
        neighborhood: true, price: true, memberPrice: true, totalSpots: true,
        emoji: true, isPremium: true, membersOnly: true, limitedSpots: true, status: true,
        seriesId: true,
      }
    })
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (clubHost && before.hostId !== session.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { tagIds, applyToSeries } = body

    const ALLOWED_FIELDS = [
      'title', 'date', 'time', 'location', 'neighborhood', 'address', 'description',
      'totalSpots', 'spotsLeft', 'price', 'memberPrice', 'emoji', 'isPremium',
      'membersOnly', 'limitedSpots', 'vibes', 'status', 'coverImage', 'coverImagePosition', 'meetingUrl',
      'whatsappUrl', 'minAge', 'maxAge', 'language', 'difficulty', 'refundPolicy',
      'registrationDeadline', 'endTime', 'currency', 'approvalRequired', 'isRecurring',
      'lat', 'lng', 'featured', 'genderBalance', 'maleQuota', 'femaleQuota', 'turkishMaleQuota',
      'cancelReason', 'duration', 'clubId', 'hostId', 'seriesId',
    ]
    const rest: Record<string, unknown> = {}
    for (const key of ALLOWED_FIELDS) {
      if (key in body) rest[key] = body[key]
    }

    // URL validation
    const safeLocalFile = (v: unknown) => !v || /^\/app\/api\/files\/[a-zA-Z0-9\-]+\/[a-zA-Z0-9\-]+\.(jpg|jpeg|png|webp|gif)$/.test(String(v))
    const safeHttps     = (v: unknown) => !v || (typeof v === 'string' && v.startsWith('https://'))
    if ('coverImage'  in rest && !safeLocalFile(rest.coverImage))
      return NextResponse.json({ error: 'Invalid cover image URL' }, { status: 400 })
    if ('meetingUrl'  in rest && !safeHttps(rest.meetingUrl))
      return NextResponse.json({ error: 'Meeting URL must start with https://' }, { status: 400 })
    if ('whatsappUrl' in rest && !safeHttps(rest.whatsappUrl))
      return NextResponse.json({ error: 'WhatsApp URL must start with https://' }, { status: 400 })

    // Hosts cannot reassign event ownership or move to an unmanaged club
    if (clubHost) {
      delete rest.hostId
      delete rest.featured
      if (rest.clubId && rest.clubId !== before.clubId) {
        if (!await isClubHostFor(session.id, rest.clubId as string)) {
          return NextResponse.json({ error: 'You are not a host of the target club' }, { status: 403 })
        }
      }
    }

    const data: Record<string, unknown> = { ...rest }
    const toInt = (v: unknown) => parseInt(String(v))
    if (data.totalSpots  !== undefined) data.totalSpots  = toInt(data.totalSpots)  || 0
    if (data.spotsLeft   !== undefined) data.spotsLeft   = toInt(data.spotsLeft)   || 0
    if (data.price       !== undefined) data.price       = toInt(data.price)       || 0
    if (data.memberPrice !== undefined && data.memberPrice !== null && data.memberPrice !== '')
      data.memberPrice = toInt(data.memberPrice)
    else if (data.memberPrice === '') data.memberPrice = null
    if (data.minAge !== undefined && data.minAge !== null && data.minAge !== '')
      data.minAge = toInt(data.minAge)
    else if (data.minAge === '') data.minAge = null
    if (data.maxAge !== undefined && data.maxAge !== null && data.maxAge !== '')
      data.maxAge = toInt(data.maxAge)
    else if (data.maxAge === '') data.maxAge = null
    if (data.lat !== undefined && data.lat !== null && data.lat !== '')
      data.lat = parseFloat(String(data.lat))
    else if (data.lat === '' || data.lat === null) data.lat = null
    if (data.lng !== undefined && data.lng !== null && data.lng !== '')
      data.lng = parseFloat(String(data.lng))
    else if (data.lng === '' || data.lng === null) data.lng = null

    // Handle tag updates
    if (Array.isArray(tagIds)) {
      data.tags = {
        deleteMany: {},
        create: tagIds.map((tagId: string) => ({ tagId })),
      }
    }

    const event = await prisma.event.update({ where: { id }, data })

    // Propagate changes to all future events in the same series (except date/time which are per-event)
    if (applyToSeries && before.seriesId) {
      const SERIES_EXCLUDED = new Set(['date', 'time', 'registrationDeadline', 'seriesId', 'tags'])
      const seriesData: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(data)) {
        if (!SERIES_EXCLUDED.has(k)) seriesData[k] = v
      }
      if (Object.keys(seriesData).length > 0) {
        const today = new Date().toISOString().split('T')[0]
        await prisma.event.updateMany({
          where: { seriesId: before.seriesId, id: { not: id }, date: { gte: today } },
          data: seriesData,
        })
      }
    }

    // Log enriched audit
    const diff = getDiff(before, rest)
    if (diff) {
      writeAudit(session.id, session.name, 'event.update', id, 'event',
        { diff, title: before.title },
        `Updated event "${before.title}"`
      )
    }

    // Notify new host if host assignment changed
    if (rest.hostId && rest.hostId !== before.hostId) {
      createNotification(
        rest.hostId as string,
        'host_assigned',
        'You\'ve been assigned to host an event! 🎤',
        `You've been assigned as host for "${before.title}". Head to your host panel to manage it.`,
        '/host/events'
      ).catch(() => {})
    }

    // Notify attendees if date, time, or location changed
    const changed = (body.date && body.date !== before.date) ||
                    (body.time && body.time !== before.time) ||
                    (body.location && body.location !== before.location)
    if (changed) {
      ;(async () => {
        const attendees = await prisma.eventAttendee.findMany({ where: { eventId: id, status: 'approved' }, select: { userId: true } })
        await Promise.all(attendees.map(a =>
          createNotification(a.userId, 'event_updated', 'Event details changed 📅', `"${before.title}" has been updated — check the new time or location`, `/events/${id}`)
        ))
      })().catch(() => {})
    }

    // Email all approved attendees if event was just cancelled
    if (body.status === 'cancelled' && before.status !== 'cancelled') {
      ;(async () => {
        const attendees = await prisma.eventAttendee.findMany({
          where: { eventId: id, status: 'approved' },
          include: { user: { select: { email: true, name: true } } },
        })
        await Promise.all(attendees.map(a =>
          sendEventCancelledEmail(a.user.email, a.user.name ?? 'Member', before.title, before.date).catch(() => {})
        ))
        // Also notify in-app
        await Promise.all(attendees.map(a =>
          createNotification(a.userId, 'event_cancelled', 'Event cancelled 😔', `"${before.title}" has been cancelled.`, '/events').catch(() => {})
        ))
      })().catch(() => {})
    }

    return NextResponse.json(event)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// Moderators can change event status (approve / flag / unpublish)
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params
    const { status } = await req.json()
    const allowed = ['published', 'flagged', 'unpublished', 'pending']
    if (!allowed.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    const before = await prisma.event.findUnique({
      where: { id },
      select: { title: true, hostId: true, clubId: true, status: true },
    })
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const event = await prisma.event.update({ where: { id }, data: { status } })

    writeAudit(session.id, session.name, `event.${status}`, id, 'event',
      { status },
      `Event status set to ${status}`,
    )

    // When approving a pending event: notify host + club members
    if (status === 'published' && before.status === 'pending') {
      ;(async () => {
        // Notify the host
        if (before.hostId) {
          await createNotification(
            before.hostId, 'host_assigned',
            'Your event has been approved! 🎉',
            `"${before.title}" is now live and visible to members.`,
            `/host/events`,
          ).catch(() => {})
        }
        // Notify club members
        if (before.clubId) {
          const [members, club] = await Promise.all([
            prisma.clubMembership.findMany({
              where: { clubId: before.clubId, status: 'approved', userId: { not: before.hostId ?? undefined } },
              select: { userId: true },
            }),
            prisma.club.findUnique({ where: { id: before.clubId }, select: { name: true } }),
          ])
          await Promise.all(members.map(m =>
            createNotification(m.userId, 'new_event',
              `New event in ${club?.name ?? 'your club'} 🎉`,
              `"${before.title}" has just been posted`,
              `/events/${id}`,
            )
          ))
        }
      })().catch(() => {})
    }

    return NextResponse.json(event)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
