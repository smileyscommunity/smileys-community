import { isAdmin } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { sendReviewRequestEmail, sendListingExpiryEmail, recordEmailFailure } from '@/lib/email'
import { sendPushToUser } from '@/lib/push'
import { getSession } from '@/lib/session'
import { citiesByToday, type CityDay } from '@/lib/city'
import { uploadRoot } from '@/lib/uploadRoot'

// One findMany instead of a findFirst per attendee. The per-row shape ran
// events × attendees queries every nightly sweep — easily 1–2k round trips;
// each loop below now pre-fetches its dedupe set in a single query.
async function sentKeys(type: string, userIds: string[], links: string[]): Promise<Set<string>> {
  if (userIds.length === 0 || links.length === 0) return new Set()
  const rows = await prisma.notification.findMany({
    where:  { type, userId: { in: userIds }, link: { in: links } },
    select: { userId: true, link: true },
  })
  return new Set(rows.map(r => `${r.userId}:${r.link}`))
}

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
  // Yesterday / today / tomorrow, per city. This sweep ARCHIVES events whose
  // date has passed and mails their attendees, so a single network-wide
  // "today" retires a city's events — and sends its post-event mail — while
  // that day is still running there. Cities sharing a zone share a group, so
  // today this is the same set of queries it has always been.
  const [yesterdayGroups, todayGroups, tomorrowGroups] = await Promise.all([
    citiesByToday(-1), citiesByToday(), citiesByToday(1),
  ])
  // `date` is a bare calendar day, so each arm pairs a day with the cities it
  // belongs to. One arm today; a second only once a city lives elsewhere.
  const onDay   = (gs: CityDay[]) => gs.map(({ date, cityIds }) => ({ date, cityId: { in: cityIds } }))
  const before  = (gs: CityDay[]) => gs.map(({ date, cityIds }) => ({ date: { lt: date }, cityId: { in: cityIds } }))
  const todayOrTomorrow = [...todayGroups, ...tomorrowGroups]

  // Auto-archive published events whose date has passed
  const { count: archivedCount } = await prisma.event.updateMany({
    where: { OR: before(todayGroups), status: 'published' },
    data:  { status: 'archived' },
  })

  // Auto-expire listings past their expiry date
  await prisma.listing.updateMany({
    where: { expiresAt: { lt: now }, status: 'active' },
    data:  { status: 'expired' },
  })

  // Auto-expire visitor announcements whose trip has ended
  await prisma.visitorAnnouncement.updateMany({
    where: {
      OR: todayGroups.map(({ date, cityIds }) => ({ endsOn: { lt: date }, cityId: { in: cityIds } })),
      status: 'active',
    },
    data:  { status: 'expired' },
  })

  // Auto-expire hangouts past their endsAt — keeps the feed current
  await prisma.hangout.updateMany({
    where: { endsAt: { lt: now }, status: 'active' },
    data:  { status: 'expired' },
  })

  // Listing expiry warnings — 7 days and 3 days before expiry
  const in7days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const in3days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
  const expiringListings = await prisma.listing.findMany({
    where: { status: 'active', expiresAt: { gte: now, lte: in7days } },
    include: { user: { select: { id: true, email: true, name: true } } },
  })
  // Pre-fetch the latest expiry reminder per (user, listing) in one query —
  // this loop ran a findFirst per expiring listing.
  const expiryRows = await prisma.notification.findMany({
    where: {
      type: 'listing_expiry',
      userId: { in: [...new Set(expiringListings.map(l => l.userId))] },
      link:   { in: expiringListings.flatMap(l => [`/board/${l.id}`, `/listings/${l.id}`]) },
    },
    select: { userId: true, link: true, createdAt: true },
  })
  const latestExpiryNote = new Map<string, number>()
  for (const r of expiryRows) {
    if (!r.link) continue
    const lid = r.link.split('/').pop()!
    const key = `${r.userId}:${lid}`
    const t = new Date(r.createdAt).getTime()
    if ((latestExpiryNote.get(key) ?? 0) < t) latestExpiryNote.set(key, t)
  }
  for (const listing of expiringListings) {
    const daysLeft = Math.ceil((listing.expiresAt.getTime() - Date.now()) / 86400000)
    const isWarningDay = daysLeft === 7 || daysLeft === 3
    if (!isWarningDay) continue
    // Dedup PER LISTING (was per user, which silently suppressed the warning
    // for a member's second expiring listing). Link points at the listing's
    // own page so they can renew it directly; also match the pre-rename
    // /listings/<id> form. NB: reminders from before the rename linked to the
    // /listings index (no id), so during the ~2-day dedup window right after
    // the rename a member could get one extra reminder — a duplicate is far
    // safer here than missing an expiry warning and losing the listing.
    const listingLink = `/board/${listing.id}`
    const lastSent = latestExpiryNote.get(`${listing.userId}:${listing.id}`)
    if (lastSent && Date.now() - lastSent < 2 * 24 * 60 * 60 * 1000) continue
    await createNotification(
      listing.userId,
      'listing_expiry',
      `Listing expiring in ${daysLeft} days ⏳`,
      `"${listing.title}" will be removed from the Community Board soon — renew it to keep it visible.`,
      listingLink,
    )
    // EM3 fix: log SMTP failures so a silent outage doesn't make
    // every listing-expiry reminder vanish without trace. Cron
    // is automated — there's no admin in the loop to notice.
    sendListingExpiryEmail(listing.user.email, listing.user.name, listing.title, daysLeft, listing.id)
      .catch(async err => {
        console.error('[cron reminders] sendListingExpiryEmail failed', { listingId: listing.id, userId: listing.userId, err: String(err) })
        await recordEmailFailure({ helper: 'sendListingExpiryEmail', recipient: listing.user.email, error: err, context: { listingId: listing.id, userId: listing.userId } })
      })
  }

  // Post-event connection suggestions — send to attendees of events that just archived (yesterday)
  const justArchivedEvents = await prisma.event.findMany({
    where: { OR: onDay(yesterdayGroups), status: 'archived' },
    include: {
      attendees: {
        where: { status: 'approved' },
        select: { userId: true },
      },
    },
  })

  let sentConnections = 0
  const connSent = await sentKeys(
    'connection_suggestion',
    justArchivedEvents.flatMap(e => e.attendees.map(a => a.userId)),
    justArchivedEvents.map(e => `/events/${e.id}`),
  )
  for (const event of justArchivedEvents) {
    const attendeeIds = event.attendees.map(a => a.userId)
    if (attendeeIds.length < 2) continue

    for (const userId of attendeeIds) {
      if (connSent.has(`${userId}:/events/${event.id}`)) continue

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
      where: { OR: onDay(todayOrTomorrow), status: 'published' },
      include: { attendees: { where: { status: 'approved' }, select: { userId: true } } },
    }),
    prisma.event.findMany({
      where: { OR: onDay(yesterdayGroups), status: { in: ['published', 'archived'] } },
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

  const upcomingAttendeeIds = upcomingEvents.flatMap(e => e.attendees.map(a => a.userId))
  const upcomingLinks = upcomingEvents.map(e => `/events/${e.id}`)
  const [sent24Set, sent2Set] = await Promise.all([
    sentKeys('reminder_24h', upcomingAttendeeIds, upcomingLinks),
    sentKeys('reminder_2h',  upcomingAttendeeIds, upcomingLinks),
  ])
  for (const event of upcomingEvents) {
    const eventTime = new Date(`${event.date}T${event.time.length === 5 ? event.time : event.time.substring(0, 5)}:00`)
    const diffHours = (eventTime.getTime() - now.getTime()) / (60 * 60 * 1000)

    const is24h = diffHours >= 23 && diffHours <= 25
    const is2h  = diffHours >= 1  && diffHours <= 3

    if (!is24h && !is2h) continue

    for (const { userId } of event.attendees) {
      if (is24h) {
        if (!sent24Set.has(`${userId}:/events/${event.id}`)) {
          await createNotification(userId, 'reminder_24h', 'Event tomorrow ⏰', `"${event.title}" is tomorrow at ${event.time}`, `/events/${event.id}`)
          sendPushToUser(userId, { title: 'Event tomorrow ⏰', body: `"${event.title}" is tomorrow at ${event.time}`, link: `/events/${event.id}` }).catch(() => {})
          sent24h++
        }
      }
      if (is2h) {
        if (!sent2Set.has(`${userId}:/events/${event.id}`)) {
          await createNotification(userId, 'reminder_2h', 'Starting soon ⚡', `"${event.title}" starts in ~2 hours at ${event.time}`, `/events/${event.id}`)
          sendPushToUser(userId, { title: 'Starting soon ⚡', body: `"${event.title}" starts in ~2 hours at ${event.time}`, link: `/events/${event.id}` }).catch(() => {})
          sent2h++
        }
      }
    }
  }

  // Review requests — yesterday's events
  const reviewSent = await sentKeys('review_request',
    pastEvents.flatMap(e => e.attendees.map(a => a.user.id)), ['/reviews'])
  for (const event of pastEvents) {
    for (const attendee of event.attendees) {
      const userId = attendee.user.id
      if (!reviewSent.has(`${userId}:/reviews`)) {
        // Mark locally too — two of yesterday's events sharing an attendee
        // must not send twice within this run (the DB row from the first
        // send isn't in the pre-fetched set).
        reviewSent.add(`${userId}:/reviews`)
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

  // Orphan-photo janitor for /api/apply/upload — that endpoint has no auth and
  // accepts anonymous uploads at 5/hour/IP, so old files accumulate. Delete any
  // file >30 days old that no MemberApplication still references.
  let purgedPhotos = 0
  try {
    const dir = join(uploadRoot(), 'applications')
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const files = readdirSync(dir)
    const referenced = new Set(
      (await prisma.memberApplication.findMany({
        where: { profilePhoto: { startsWith: '/app/api/files/applications/' } },
        select: { profilePhoto: true },
      })).map(a => a.profilePhoto!.split('/').pop()!)
    )
    for (const name of files) {
      if (referenced.has(name)) continue
      const path = join(dir, name)
      try {
        if (statSync(path).mtimeMs < cutoff) {
          unlinkSync(path)
          purgedPhotos++
        }
      } catch {}
    }
  } catch {}

  return NextResponse.json({ ok: true, sent24h, sent2h, sentReviews, archivedCount, sentConnections, checkedEvents: upcomingEvents.length + pastEvents.length, expiringListings: expiringListings.length, purgedPhotos })
}
