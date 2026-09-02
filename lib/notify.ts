import { prisma } from './prisma'
import { sendPushToUser } from './push'
import { getCityTz } from './city'
import { nowInTz, DEFAULT_TZ } from './cityTime'

// Which preference field gates each type. null = always send (transactional).
const PREF_KEY: Record<string, 'newEvents' | 'reminders' | 'eventUpdates' | 'joinedEvents' | 'wallPosts' | 'wallReplies' | null> = {
  new_event:         'newEvents',
  reminder_24h:      'reminders',
  reminder_2h:       'reminders',
  event_updated:     'eventUpdates',
  attendee_joined:   'joinedEvents',
  event_message:     'joinedEvents',
  // Photos added to an event you attended — same "activity on my event"
  // signal class as messages, so the same preference gates it.
  event_photos:      'joinedEvents',
  review_request:    'reminders',
  // transactional — always deliver:
  rsvp:               null,
  rsvp_pending:       null,
  waitlist:           null,
  waitlist_promoted:  null,
  club_approved:      null,
  club_rejected:      null,
  host_assigned:      null,
  application:        null,
  report:             null,
  event_cancelled:    null,
  warning:            null,
  system_alert:       null,
  announcement:       null,
  connection_request:    null,
  connection_accepted:   null,
  connection_suggestion: null,
  profile_view:          null,
  host_message:       null,
  message:            null,
  club_wall_post:       'wallPosts',
  club_post_reply:      'wallReplies',
  club_mention:         null,
  neighborhood_mention: null,
  // Hangout + visitor types — all transactional (high-signal, user-initiated).
  hangout_join:       null,
  hangout_message:    null,
  hangout_starting:   null,  // "starts in 30 min" reminder from sweeper cron
  hangout_recap:      null,  // "ended — hope it was good" closer from sweeper cron
  hangout_cancelled:  null,  // host cancelled — notify joiners
  // Wide-fanout broadcast when a hangout posts in someone's neighborhood
  // OR a neighborhood they've previously joined hangouts in. Gated by the
  // newEvents preference so users who muted event broadcasts also mute
  // hangout broadcasts — it's the same "something is happening near you"
  // signal class.
  new_hangout:        'newEvents',
  // New editorial article published (handbook or community). Same "something
  // new worth checking" signal class as new_event / new_hangout, so the
  // newEvents preference + quiet hours gate it too — members who muted event
  // broadcasts also mute article pings.
  new_article:        'newEvents',
  // Availability-pulse broadcast to the poster's accepted connections
  // ("X is free to meet now"). Same "something near you" signal class as
  // new_hangout, so the newEvents preference + quiet hours gate it too —
  // members who muted broadcasts don't get pinged.
  availability_pulse: 'newEvents',
  // "✋ X is free too" — direct response to the recipient's own pulse.
  // Transactional: you asked who's around; someone answered.
  pulse_wave:         null,
  visitor_announced:  null,
  listing_new:        null,
  // Admin-only: fired on every non-admin directory submission so the
  // moderator team gets a distinct bell entry (with its own icon) and
  // an email. Transactional — never gated by prefs.
  directory_submission: null,
  // Fired when an admin grants premium/VIP. Transactional — a status
  // change the member should always hear about.
  membership_upgraded: null,
  // Survey nudges — transactional in spirit (quarterly, low volume,
  // signal-bearing). Always delivered so a muted "newEvents" pref
  // doesn't silently swallow the community-pulse signal.
  event_survey:       null,
  nps_survey:         null,
  // No-show cards — transactional, every one. A warning, a block, an appeal
  // outcome or a waiver is something the member must always hear about;
  // the admin one is the appeals inbox ping.
  no_show_yellow:              null,
  no_show_red:                 null,
  no_show_restriction_active:  null,
  no_show_waived:              null,
  no_show_downgraded:          null,
  no_show_appeal:              null,
  no_show_appeal_resolved:     null,
  no_show_waitlist_removed:    null,
}

// Quiet hours are the MEMBER's evening, so the hour is read on their home
// city's clock — not the founding city's. Hand-built UTC offsets are how
// this used to work and exactly what lib/cityTime.ts warns against.
async function inQuietWindow(userId: string, from: number, to: number): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { cityId: true } })
  const h = nowInTz(user?.cityId ? await getCityTz(user.cityId) : DEFAULT_TZ).hour
  return from > to ? (h >= from || h < to) : (h >= from && h < to)
}

export async function createNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  link?: string,
) {
  try {
    const prefKey = PREF_KEY[type]

    // Quiet hours suppress only the push ping — the in-app bell entry is still
    // recorded, so a notification sent during a member's quiet window is there
    // waiting when they next open notifications rather than vanishing. Muting a
    // type (pref = false) still skips it entirely.
    let suppressPush = false
    if (prefKey !== undefined && prefKey !== null) {
      const prefs = await prisma.notificationPreference.findUnique({ where: { userId } })
      if (prefs) {
        if (!prefs[prefKey]) return
        if (prefs.quietHours && await inQuietWindow(userId, prefs.quietFrom, prefs.quietTo)) suppressPush = true
      }
    }

    // Bundle attendee_joined within 1 hour into a single notification
    if (type === 'attendee_joined' && link) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      const existing = await prisma.notification.findFirst({
        where: { userId, type: 'attendee_joined', link, isRead: false, createdAt: { gte: oneHourAgo } },
        orderBy: { createdAt: 'desc' },
      })
      if (existing) {
        const match = existing.title.match(/^(\d+) people/)
        const count = match ? parseInt(match[1]) + 1 : 2
        const eventName = existing.body.match(/"(.+)"$/)?.[1] ?? 'your event'
        await prisma.notification.update({
          where: { id: existing.id },
          data: { title: `${count} people joined your event`, body: `${count} people have joined "${eventName}"` },
        })
        return
      }
    }

    // Bundle event_photos within 6 hours — a post-event upload burst
    // becomes one evolving notification per attendee, not one ping per
    // photo. Only the first photo triggers a push (same trade-off as
    // the attendee_joined bundling above).
    if (type === 'event_photos' && link) {
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)
      const existing = await prisma.notification.findFirst({
        where: { userId, type: 'event_photos', link, isRead: false, createdAt: { gte: sixHoursAgo } },
        orderBy: { createdAt: 'desc' },
      })
      if (existing) {
        const match = existing.title.match(/(\d+) new photos/)
        const count = match ? parseInt(match[1]) + 1 : 2
        const eventName = existing.body.match(/"(.+)"/)?.[1] ?? 'an event you attended'
        await prisma.notification.update({
          where: { id: existing.id },
          data: { title: `📸 ${count} new photos`, body: `${count} photos were added to "${eventName}"` },
        })
        return
      }
    }

    await prisma.notification.create({ data: { userId, type, title, body, link } })

    // Fire push notification (non-blocking, best-effort). Skipped during the
    // member's quiet hours — the bell entry above was still recorded.
    if (!suppressPush) sendPushToUser(userId, { title, body, link }).catch(() => {})
  } catch (e) {
    console.error('Failed to create notification:', e)
  }
}

// Broadcast a freshly published article to the whole approved membership.
// Gated per-user by the `newEvents` preference (via PREF_KEY['new_article'])
// so muted members and quiet hours are respected inside createNotification.
// The author is excluded — they just published it.
//
// Call this fire-and-forget from the publish route: the fan-out over the full
// member list must not block the admin's save response. Best-effort, matching
// the push side of createNotification above.
export async function notifyNewArticle(post: {
  id: string
  title: string
  slug: string
  kind: string | null
  authorId: string | null
  cityId: string | null
}) {
  // Atomically claim the broadcast: only the caller that flips notifiedAt from
  // null proceeds. Closes the double-submit race (two concurrent publishes),
  // the unpublish→republish re-notify, and a backfill re-run — all become
  // no-ops once an article has been announced. To deliberately re-announce,
  // clear notifiedAt first.
  const claim = await prisma.post.updateMany({
    where: { id: post.id, notifiedAt: null },
    data:  { notifiedAt: new Date() },
  })
  if (claim.count === 0) return

  const isHandbook = post.kind === 'handbook'
  const link  = isHandbook ? `/handbook/${post.slug}` : `/posts/${post.slug}`
  const title = isHandbook ? '📖 New in the Handbook' : '📰 New from Smileys'

  const members = await prisma.user.findMany({
    // City-local articles ping their city only; global (cityId null) pings
    // everyone — same null-means-global rule the read paths follow. Without
    // this, an İzmir-only article belled all 1,600 Istanbul members.
    where: {
      status: 'approved',
      ...(post.cityId ? { cityId: post.cityId } : {}),
      ...(post.authorId ? { id: { not: post.authorId } } : {}),
    },
    select: { id: true },
  })

  // Fan out in bounded batches. A whole-membership `Promise.allSettled` would
  // dispatch ~1k×(pref lookup + insert + push) concurrently against the pg
  // pool (default max 10), starving other requests and spiking latency. 50 at
  // a time keeps the pool healthy while still completing the broadcast quickly.
  const BATCH = 50
  for (let i = 0; i < members.length; i += BATCH) {
    await Promise.allSettled(
      members.slice(i, i + BATCH).map(m => createNotification(m.id, 'new_article', title, post.title, link)),
    )
  }
}

// Announce a newly published CLUB event to that club's approved members
// (excluding the host). Call from every publish path — create-as-published,
// approve (pending→published), and edit-to-publish (draft→published) — so an
// event can't go live silently regardless of how it was published. Idempotency-
// guarded on the event link: publishing via multiple paths, a double-submit, or
// a manual re-run announces only once. Batched like notifyNewArticle to spare
// the pg pool. Non-club events have no member audience and are skipped.
export async function notifyNewEvent(event: {
  id: string
  title: string
  clubId: string | null
  hostId: string | null
}) {
  if (!event.clubId) return
  const link = `/events/${event.id}`
  const already = await prisma.notification.count({ where: { type: 'new_event', link } })
  if (already > 0) return

  const [club, members] = await Promise.all([
    prisma.club.findUnique({ where: { id: event.clubId }, select: { name: true } }),
    prisma.clubMembership.findMany({
      where: { clubId: event.clubId, status: 'approved', ...(event.hostId ? { userId: { not: event.hostId } } : {}) },
      select: { userId: true },
    }),
  ])
  const title = `New event in ${club?.name ?? 'your club'} 🎉`
  const body  = `"${event.title}" has just been posted`

  const BATCH = 50
  for (let i = 0; i < members.length; i += BATCH) {
    await Promise.allSettled(
      members.slice(i, i + BATCH).map(m => createNotification(m.userId, 'new_event', title, body, link)),
    )
  }
}
