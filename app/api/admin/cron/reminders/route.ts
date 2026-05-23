import { isAdmin } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { sendReviewRequestEmail, sendListingExpiryEmail } from '@/lib/email'
import { sendPushToUser } from '@/lib/push'
import { getSession } from '@/lib/session'
import { todayIstanbul } from '@/lib/data'

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('CRON_SECRET is not set — cron endpoint disabled')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const headerSecret = req.headers.get('x-cron-secret') ?? ''
  const a = Buffer.from(headerSecret)
  const b = Buffer.from(cronSecret)
  const secretOk = a.length === b.length && timingSafeEqual(a, b)
  if (!secretOk) {
    const session = await getSession()
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  const now          = new Date()
  const todayStr     = todayIstanbul()
  const tomorrowStr  = todayIstanbul(1)
  const yesterdayStr = todayIstanbul(-1)

  // Auto-archive published events whose date has passed
  const { count: archivedCount } = await prisma.event.updateMany({
    where: { date: { lt: todayStr }, status: 'published' },
    data:  { status: 'archived' },
  })

  // Auto-expire listings past their expiry date
  await prisma.listing.updateMany({
    where: { expiresAt: { lt: now }, status: 'active' },
    data:  { status: 'expired' },
  })

  // Listing expiry warnings — 7 days and 3 days before expiry
  const in7days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const in3days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  const expiringListings = await prisma.listing.findMany({
    where: { status: 'active', expiresAt: { gte: now, lte: in7days } },
    include: { user: { select: { id: true, email: true, name: true } } },
  })
  for (const listing of expiringListings) {
    const daysLeft = Math.ceil((listing.expiresAt.getTime() - Date.now()) / 86400000)
    const isWarningDay = daysLeft === 7 || daysLeft === 3
    if (!isWarningDay) continue
    const alreadyNotified = await prisma.notification.findFirst({
      where: { userId: listing.userId, type: 'listing_expiry', link: `/listings` },
      orderBy: { createdAt: 'desc' },
    })
    const recentlyNotified = alreadyNotified && (Date.now() - new Date(alreadyNotified.createdAt).getTime()) < 2 * 24 * 60 * 60 * 1000
    if (recentlyNotified) continue
    await createNotification(
      listing.userId,
      'listing_expiry',
      `Listing expiring in ${daysLeft} days ⏳`,
      `"${listing.title}" will be removed from the Community Board soon — renew it to keep it visible.`,
      `/listings`,
    )
    sendListingExpiryEmail(listing.user.email, listing.user.name, listing.title, daysLeft).catch(() => {})
  }

  // Post-event connection suggestions — send to attendees of events that just archived (yesterday)
  const justArchivedEvents = await prisma.event.findMany({
    where: { date: yesterdayStr, status: 'archived' },
    include: {
      attendees: {
        where: { status: 'approved' },
        select: { userId: true },
      },
    },
  })

  let sentConnections = 0
  for (const event of justArchivedEvents) {
    const attendeeIds = event.attendees.map(a => a.userId)
    if (attendeeIds.length < 2) continue

    for (const userId of attendeeIds) {
      // Skip if already sent a connection suggestion for this event
      const exists = await prisma.notification.findFirst({
        where: { userId, type: 'connection_suggestion', link: `/events/${event.id}` },
      })
      if (exists) continue

      const othersCount = attendeeIds.length - 1
      await createNotification(
        userId,
        'connection_suggestion',
        'People you met 👋',
        `You attended "${event.title}" with ${othersCount} other member${othersCount !== 1 ? 's' : ''} — connect with someone you met!`,
        `/events/${event.id}`
      )
      sentConnections++
    }
  }


  const [upcomingEvents, pastEvents] = await Promise.all([
    prisma.event.findMany({
      where: { date: { in: [todayStr, tomorrowStr] }, status: 'published' },
      include: { attendees: { where: { status: 'approved' }, select: { userId: true } } },
    }),
    prisma.event.findMany({
      where: { date: yesterdayStr, status: { in: ['published', 'archived'] } },
      include: {
        attendees: {
          where: { status: 'approved' },
          include: { user: { select: { id: true, name: true, email: true } } },
        },
      },
    }),
  ])

  let sent24h = 0
  let sent2h  = 0
  let sentReviews = 0

  for (const event of upcomingEvents) {
    const eventTime = new Date(`${event.date}T${event.time.length === 5 ? event.time : event.time.substring(0, 5)}:00`)
    const diffHours = (eventTime.getTime() - now.getTime()) / (60 * 60 * 1000)

    const is24h = diffHours >= 23 && diffHours <= 25
    const is2h  = diffHours >= 1  && diffHours <= 3

    if (!is24h && !is2h) continue

    for (const { userId } of event.attendees) {
      if (is24h) {
        const exists = await prisma.notification.findFirst({
          where: { userId, type: 'reminder_24h', link: `/events/${event.id}` },
        })
        if (!exists) {
          await createNotification(userId, 'reminder_24h', 'Event tomorrow ⏰', `"${event.title}" is tomorrow at ${event.time}`, `/events/${event.id}`)
          sendPushToUser(userId, { title: 'Event tomorrow ⏰', body: `"${event.title}" is tomorrow at ${event.time}`, link: `/events/${event.id}` }).catch(() => {})
          sent24h++
        }
      }
      if (is2h) {
        const exists = await prisma.notification.findFirst({
          where: { userId, type: 'reminder_2h', link: `/events/${event.id}` },
        })
        if (!exists) {
          await createNotification(userId, 'reminder_2h', 'Starting soon ⚡', `"${event.title}" starts in ~2 hours at ${event.time}`, `/events/${event.id}`)
          sendPushToUser(userId, { title: 'Starting soon ⚡', body: `"${event.title}" starts in ~2 hours at ${event.time}`, link: `/events/${event.id}` }).catch(() => {})
          sent2h++
        }
      }
    }
  }

  // Review requests — yesterday's events
  for (const event of pastEvents) {
    for (const attendee of event.attendees) {
      const userId = attendee.user.id
      const exists = await prisma.notification.findFirst({
        where: { userId, type: 'review_request', link: `/reviews` },
      })
      if (!exists) {
        await createNotification(
          userId,
          'review_request',
          'How was it? Leave a review ⭐',
          `You attended "${event.title}" — share your experience so others know what to expect.`,
          `/reviews`
        )
        Promise.resolve(
          sendReviewRequestEmail(attendee.user.email, attendee.user.name, event.title, event.emoji)
        ).catch(e => console.error('Review email error:', e))
        sentReviews++
      }
    }
  }

  return NextResponse.json({ ok: true, sent24h, sent2h, sentReviews, archivedCount, sentConnections, checkedEvents: upcomingEvents.length + pastEvents.length, expiringListings: expiringListings.length })
}
