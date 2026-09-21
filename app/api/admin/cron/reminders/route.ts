import { isAdmin } from '@/lib/access'
import { claimOnce, releaseClaim } from '@/lib/rateLimit'
import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'
import { sendReviewRequestEmail, sendListingExpiryEmail, recordEmailFailure } from '@/lib/email'
import { checkInIsCredible, isNoShow, eventRunners, noShowExemptionReason } from '@/lib/noShowPolicy'
import { eventTier, cancelCutoffHours } from '@/lib/standingPolicy'
import { getSession } from '@/lib/session'
import { recordCronRun } from '@/lib/cronHealth'
import { citiesByToday, type CityDay } from '@/lib/city'
import { eventStartsAt } from '@/lib/eventTime'
import { checkInNudges } from '@/lib/checkInNudge'
import { DEFAULT_TZ } from '@/lib/cityTime'

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

type AttendanceRow = {
  userId: string; status: string; checkedIn: boolean; attendance: string; cancelledAt: Date | null; cancelledBy: string | null
  user: { role: string } | null
}

// The event's approved club hosts — the same select lib/noShow settleEvent
// feeds to eventRunners.
const CLUB_HOSTS = { select: { memberships: { where: { role: 'host', status: 'approved' }, select: { userId: true } } } }

/**
 * The approved rows that actually came — the only ones a "you attended"
 * nudge may address. Status alone kept a settled no-show (attendance
 * 'no_show', status still 'approved') in both the review ask and the
 * connection suggestion. Same definition the no-show sweep applies
 * (lib/noShowPolicy): a scan always counts as attended; once check-in is
 * credible an unscanned seat is a no-show even before the sweep has
 * stamped it.
 *
 * Exemption is the sweep's too (noShowExemptionReason): host, co-hosts,
 * the club's hosts and admins/moderators are never no-shows and never in
 * the check-in ratio's room. Being exempt is not proof of being there,
 * though: the event's own host and co-hosts ran it, so they count as
 * attended; a club host or admin/moderator who wasn't scanned may never
 * have come, so they are only nudged on a scan.
 */
function attendedRows<T extends AttendanceRow>(
  event: { hostId: string | null; cohosts: { userId: string }[]; club: { memberships: { userId: string }[] } | null },
  rows: T[],
  startsAt: Date,
): T[] {
  const runners  = eventRunners(event)
  const exempt   = new Map(rows.map(a => [a, noShowExemptionReason(a.userId, a.user?.role, runners)]))
  const room     = rows.filter(a => a.status === 'approved' && !exempt.get(a))
  const credible = checkInIsCredible(room.filter(a => a.checkedIn).length, room.length)
  return rows.filter(a => {
    if (a.checkedIn) return true
    const why = exempt.get(a)
    if (why === 'event_host' || why === 'event_cohost') return true
    if (why) return false
    if (a.attendance === 'no_show') return false
    // Excused by the host in the morning-after review: they weren't there.
    if (a.attendance === 'excused') return false
    return !(credible && isNoShow(a, startsAt))
  })
}

// GET is the cron's (scripts/sweep-reminders.sh), secret only. An admin runs
// it by hand with POST: a GET that archives events and sends email, accepted
// on an admin's session cookie, could be fired by a link on another site.
export async function GET(req: NextRequest) {
  if (!cronSecretOk(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return run()
}

export async function POST(req: NextRequest) {
  if (!cronSecretOk(req)) {
    const session = await getSession()
    if (!session || !isAdmin(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }
  return run()
}

function cronSecretOk(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('CRON_SECRET is not set — cron endpoint disabled')
    return false
  }
  const a = Buffer.from(req.headers.get('x-cron-secret') ?? '')
  const b = Buffer.from(cronSecret)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function run() {

  // recordCronRun stamps the run either way so the admin-dashboard
  // staleness check (lib/cronHealth) notices when the hourly dispatch
  // stops firing — same shape as sweep-event-spots.
  try {
    const result = await runSweep()
    await recordCronRun('sweep-reminders', true)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron reminders]', e)
    await recordCronRun('sweep-reminders', false, e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}

async function runSweep() {
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

  // Event.date/time are the CITY's wall clock. `new Date(`${date}T${time}`)`
  // read them in the process zone — UTC on the server — so a 19:00 Istanbul
  // event was three hours further away than it is, and "starts in ~2 hours"
  // went out as the doors opened.
  const tzByCity = new Map((await prisma.city.findMany({ select: { id: true, timezone: true } })).map(c => [c.id, c.timezone ?? DEFAULT_TZ]))
  const startsAtOf = (e: { date: string; time: string | null; cityId: string }) => eventStartsAt(e, tzByCity.get(e.cityId) ?? DEFAULT_TZ)

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

  // Hangout expiry belongs to sweep-hangouts: it flips active → expired AND
  // sends the recap push. Doing it here too (both fire at :00, this one
  // reached the update first) expired anything ending in the last quarter
  // hour with no recap for its host or joiners.

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
    // The claim survives a cleared bell (the row above does not).
    const expiryClaim = `listing-expiry:${listing.userId}:${listing.id}:${daysLeft}`
    if (!await claimOnce(expiryClaim, 3 * 24 * 60 * 60 * 1000)) continue
    // Claim first (two overlapping runs can't both send), but a write that
    // failed hands the claim back so the next hourly tick retries — and skips
    // the email, which would otherwise go out again on that retry.
    if (!await createNotification(
      listing.userId,
      'listing_expiry',
      `Listing expiring in ${daysLeft} days ⏳`,
      `"${listing.title}" will be removed from the marketplace soon — renew it to keep it visible.`,
      listingLink,
    )) {
      await releaseClaim(expiryClaim)
      continue
    }
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
    // A cancelled event can be archived and keeps its cancelledAt — nobody met there.
    where: { OR: onDay(yesterdayGroups), status: 'archived', cancelledAt: null },
    include: {
      attendees: {
        where: { status: 'approved' },
        select: { userId: true, status: true, checkedIn: true, attendance: true, cancelledAt: true, cancelledBy: true, user: { select: { role: true } } },
      },
      cohosts: { select: { userId: true } },
      club:    CLUB_HOSTS,
    },
  })

  let sentConnections = 0
  const connSent = await sentKeys(
    'connection_suggestion',
    justArchivedEvents.flatMap(e => e.attendees.map(a => a.userId)),
    justArchivedEvents.map(e => `/events/${e.id}`),
  )
  for (const event of justArchivedEvents) {
    // "People you met" is for people who were there: a no-show met nobody,
    // and isn't someone the others met either.
    const attendeeIds = attendedRows(event, event.attendees, startsAtOf(event)).map(a => a.userId)
    if (attendeeIds.length < 2) continue

    for (const userId of attendeeIds) {
      if (connSent.has(`${userId}:/events/${event.id}`)) continue
      const connClaim = `connsug:${userId}:${event.id}`
      if (!await claimOnce(connClaim, 7 * 24 * 60 * 60 * 1000)) continue

      const othersCount = attendeeIds.length - 1
      if (!await createNotification(
        userId,
        'connection_suggestion',
        'People you met 👋',
        `You attended "${event.title}" with ${othersCount} other member${othersCount !== 1 ? 's' : ''} — connect with someone you met!`,
        `/events/${event.id}`
      )) {
        await releaseClaim(connClaim)
        continue
      }
      sentConnections++
    }
  }


  const [upcomingEvents, pastEvents] = await Promise.all([
    prisma.event.findMany({
      where: { OR: onDay(todayOrTomorrow), status: 'published' },
      include: {
        attendees: { where: { status: 'approved' }, select: { userId: true, checkedIn: true } },
        cohosts:   { select: { userId: true } },
      },
    }),
    prisma.event.findMany({
      // An archived cancelled event keeps its cancelledAt: nothing to review.
      where: { OR: onDay(yesterdayGroups), status: { in: ['published', 'archived'] }, cancelledAt: null },
      include: {
        attendees: {
          where: { status: 'approved' },
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
        },
        cohosts: { select: { userId: true } },
        club:    CLUB_HOSTS,
      },
    }),
  ])

  let sent24h = 0
  let sent2h  = 0
  let sentReviews = 0
  let sentCheckInNudges = 0

  const upcomingAttendeeIds = upcomingEvents.flatMap(e => e.attendees.map(a => a.userId))
  const upcomingLinks = upcomingEvents.map(e => `/events/${e.id}`)
  const [sent24Set, sent2Set] = await Promise.all([
    sentKeys('reminder_24h', upcomingAttendeeIds, upcomingLinks),
    sentKeys('reminder_2h',  upcomingAttendeeIds, upcomingLinks),
  ])
  for (const event of upcomingEvents) {
    const eventTime = startsAtOf(event)
    const diffHours = (eventTime.getTime() - now.getTime()) / (60 * 60 * 1000)

    const is24h = diffHours >= 23 && diffHours <= 25
    const is2h  = diffHours >= 1  && diffHours <= 3

    if (!is24h && !is2h) continue

    for (const { userId } of event.attendees) {
      if (is24h) {
        const claim24 = `reminder-24h:${userId}:${event.id}`
        if (!sent24Set.has(`${userId}:/events/${event.id}`) && await claimOnce(claim24, 3 * 24 * 60 * 60 * 1000)) {
          // On a limited event a cancel after its cutoff counts toward the
          // member's standing (lib/standingPolicy), so the day-before reminder
          // names the line — any event, paid or free. Open events carry none.
          const cutoff = eventTier(event) === 'scarce' ? cancelCutoffHours(event) : null
          const body = `"${event.title}" is tomorrow at ${event.time}` + (cutoff != null
            ? `. Can't make it? Cancel as soon as you can so your seat goes to someone waiting — cancelling less than ${cutoff}h before the start counts the same as not coming.` : '')
          // createNotification sends the push itself (and honours the
          // member's "reminders" mute + quiet hours). The explicit push that
          // used to follow doubled every reminder — and for a muted member,
          // whose notification is never written and so never deduped, it
          // fired again on every hourly tick inside the window.
          // The claim is taken before the write so two runs can't both send;
          // createNotification swallows its own errors, so a failed write
          // would otherwise keep the claim and lose this reminder for the
          // whole window (the event is over before it expires). Hand it
          // back and let the next hourly tick, still inside 23–25h, retry.
          if (await createNotification(userId, 'reminder_24h', 'Event tomorrow ⏰', body, `/events/${event.id}`)) sent24h++
          else await releaseClaim(claim24)
        }
      }
      if (is2h) {
        const claim2 = `reminder-2h:${userId}:${event.id}`
        if (!sent2Set.has(`${userId}:/events/${event.id}`) && await claimOnce(claim2, 3 * 24 * 60 * 60 * 1000)) {
          // Same release-on-failure as the 24h reminder above.
          if (await createNotification(userId, 'reminder_2h', 'Starting soon ⚡', `"${event.title}" starts in ~2 hours at ${event.time}`, `/events/${event.id}`)) sent2h++
          else await releaseClaim(claim2)
        }
      }
    }
  }

  // "Check-in is open" — to the host and co-hosts, at the run nearest the
  // start, linked to the roster (lib/checkInNudge). Claimed per person per
  // event; a failed write hands the claim back, though the window has
  // usually closed by the next tick.
  for (const nudge of checkInNudges(upcomingEvents, now, startsAtOf)) {
    for (const userId of nudge.userIds) {
      const nudgeClaim = `checkin-nudge:${userId}:${nudge.eventId}`
      if (!await claimOnce(nudgeClaim, 2 * 24 * 60 * 60 * 1000)) continue
      if (await createNotification(userId, 'checkin_nudge', nudge.title, nudge.body, `/host/checkin?event=${nudge.eventId}`)) sentCheckInNudges++
      else await releaseClaim(nudgeClaim)
    }
  }

  // Review requests — yesterday's events. Keyed per EVENT: the old key was
  // the member alone with a fixed link, so a member was asked exactly once in their life
  // and every later event was skipped. And the email went out regardless
  // of the notification: a member who muted "reminders" never gets a row
  // written, so nothing deduped them and the mail repeated every hour.
  const reviewLinkFor = (eventId: string) => `/reviews?event=${eventId}`
  const pastAttendeeIds = [...new Set(pastEvents.flatMap(e => e.attendees.map(a => a.user.id)))]
  const reviewSent = await sentKeys('review_request', pastAttendeeIds, pastEvents.map(e => reviewLinkFor(e.id)))
  const reviewsMuted = new Set((await prisma.notificationPreference.findMany({
    where:  { userId: { in: pastAttendeeIds }, reminders: false },
    select: { userId: true },
  })).map(p => p.userId))
  for (const event of pastEvents) {
    // "You attended" — so only those who did (see attendedRows).
    for (const attendee of attendedRows(event, event.attendees, startsAtOf(event))) {
      const userId = attendee.user.id
      if (reviewsMuted.has(userId)) continue
      const key = `${userId}:${reviewLinkFor(event.id)}`
      const reviewClaim = `review:${userId}:${event.id}`
      if (!reviewSent.has(key) && await claimOnce(reviewClaim, 7 * 24 * 60 * 60 * 1000)) {
        // Mark locally too — the DB row from this send isn't in the
        // pre-fetched set, and the loop may see the pair again.
        reviewSent.add(key)
        // A failed write releases the claim for the next tick and skips the
        // email with it — sending the mail now would repeat it on that retry.
        if (!await createNotification(
          userId,
          'review_request',
          'How was it? Leave a review ⭐',
          `You attended "${event.title}" — share your experience so others know what to expect.`,
          reviewLinkFor(event.id)
        )) {
          await releaseClaim(reviewClaim)
          continue
        }
        Promise.resolve(
          sendReviewRequestEmail(attendee.user.email, attendee.user.name, event.title, event.emoji)
        ).catch(async e => {
          console.error('Review email error:', e)
          await recordEmailFailure({ helper: 'sendReviewRequestEmail', recipient: attendee.user.email, error: e, context: { eventId: event.id } })
        })
        sentReviews++
      }
    }
  }

  // The applications/ orphan-photo janitor that ran here moved to its own
  // nightly sweep, app/api/cron/sweep-orphan-uploads — it only checked
  // member_applications.profilePhoto, so a file still referenced from any
  // other column (a legacy member avatar) was deleted after 30 days.

  return { sent24h, sent2h, sentReviews, sentCheckInNudges, archivedCount, sentConnections, checkedEvents: upcomingEvents.length + pastEvents.length, expiringListings: expiringListings.length }
}
