import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { createNotification } from '@/lib/notify'

type Params = { params: Promise<{ id: string }> }

// GET /api/events/[id]/feedback
//
// Returns minimal event context (title, emoji, date) so the feedback
// form can render the event header. Also reports the viewer's
// eligibility so the page can show the right UX:
//
//   - { eligible: true }                 → show the form
//   - { eligible: false, reason: 'submitted' } → "Thanks, already recorded"
//   - { eligible: false, reason: 'not-attendee' } → "You weren't on this event"
//   - { eligible: false, reason: 'too-early'    } → "Event hasn't ended yet"
//   - { eligible: false, reason: 'window-closed' } → "Past the 7-day window"
//
// No PII about other attendees is exposed.
export async function GET(_: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const event = await prisma.event.findUnique({
    where:  { id },
    select: { id: true, title: true, emoji: true, date: true, endTime: true, location: true },
  })
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Eligibility cascade — checked in the order an admin would expect
  // to see in support tickets ("did they attend?" → "has it ended?"
  // → "still in window?" → "already submitted?").
  const attendance = await prisma.eventAttendee.findUnique({
    where:  { userId_eventId: { userId: session.id, eventId: id } },
    select: { status: true },
  })
  if (!attendance || attendance.status !== 'approved') {
    return NextResponse.json({ event, eligible: false, reason: 'not-attendee' })
  }

  // "Event ended" check — use endTime if set, otherwise treat the
  // event's date as ended at midnight local. todayIstanbul-style
  // comparison works because Event.date is a yyyy-mm-dd string.
  const eventEndedAt = endTimestamp(event.date, event.endTime)
  const now = Date.now()
  if (now < eventEndedAt) {
    return NextResponse.json({ event, eligible: false, reason: 'too-early' })
  }
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
  if (now > eventEndedAt + SEVEN_DAYS) {
    return NextResponse.json({ event, eligible: false, reason: 'window-closed' })
  }

  const existing = await prisma.eventSurvey.findUnique({
    where:  { eventId_userId: { eventId: id, userId: session.id } },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json({ event, eligible: false, reason: 'submitted' })
  }

  // Optional third question: when the event's venue has a directory
  // listing the responder hasn't reviewed yet, offer a star rating that
  // becomes their public review. Null when there's no match or they
  // already reviewed it — the form simply skips the question.
  const venue = await matchDirectoryVenue(event.location)
  const venueForForm = venue && !(await prisma.businessReview.findUnique({
    where:  { businessId_authorId: { businessId: venue.id, authorId: session.id } },
    select: { id: true },
  })) ? venue : null

  return NextResponse.json({ event, eligible: true, venue: venueForForm })
}

// POST /api/events/[id]/feedback
//
// Stores the survey response and, when anomaly === true, files a
// Report against the event's host so moderators can review. The
// reporter on that Report is the responding user — moderators see
// the userId server-side but it's never exposed to the host in any
// UI. The wedge of the survey is that we can ask the question safely
// BECAUSE we won't out the responder.
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  // Booleans must be explicit — undefined fails closed so a malformed
  // client doesn't write a default-false anomaly answer.
  if (typeof body.anomaly !== 'boolean' || typeof body.wouldReturn !== 'boolean') {
    return NextResponse.json({ error: 'anomaly + wouldReturn required (booleans)' }, { status: 400 })
  }
  const anomalyNote = typeof body.anomalyNote === 'string' ? body.anomalyNote.trim().slice(0, 2000) : null

  // When the responder flags an anomaly, a written explanation is
  // mandatory. An empty flag auto-files a report moderators can't act
  // on ("(no details provided)") — exactly the dead-end we hit before.
  // 10-char floor keeps it meaningful without being onerous.
  if (body.anomaly && (!anomalyNote || anomalyNote.length < 10)) {
    return NextResponse.json({ error: 'Please describe what felt off (at least 10 characters) so moderators can act on it.' }, { status: 400 })
  }

  const event = await prisma.event.findUnique({
    where:  { id },
    select: { id: true, title: true, date: true, endTime: true, hostId: true, location: true },
  })
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Optional venue rating → public directory review. Validated here,
  // written after the survey row lands (below) so a bad rating payload
  // rejects the whole submit rather than half-applying.
  const venueRating = body.venueRating === undefined ? null : Number(body.venueRating)
  if (venueRating !== null && (!Number.isInteger(venueRating) || venueRating < 1 || venueRating > 5)) {
    return NextResponse.json({ error: 'venueRating must be an integer 1–5' }, { status: 400 })
  }
  const venueComment = typeof body.venueComment === 'string' ? body.venueComment.trim().slice(0, 1000) : null

  // Re-run the eligibility checks server-side — clients can't be
  // trusted to honour the GET response.
  const attendance = await prisma.eventAttendee.findUnique({
    where:  { userId_eventId: { userId: session.id, eventId: id } },
    select: { status: true },
  })
  if (!attendance || attendance.status !== 'approved') {
    return NextResponse.json({ error: 'You were not registered for this event' }, { status: 403 })
  }

  const eventEndedAt = endTimestamp(event.date, event.endTime)
  const now = Date.now()
  if (now < eventEndedAt) {
    return NextResponse.json({ error: "The event hasn't ended yet" }, { status: 400 })
  }
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
  if (now > eventEndedAt + SEVEN_DAYS) {
    return NextResponse.json({ error: 'Feedback window has closed' }, { status: 400 })
  }

  // The unique constraint enforces one-response-per-attendee. We
  // upsert so a network retry from the client doesn't 409 — second
  // submit overwrites the first within the window. Comments-only
  // edit is the same shape.
  await prisma.eventSurvey.upsert({
    where:  { eventId_userId: { eventId: id, userId: session.id } },
    create: {
      eventId:     id,
      userId:      session.id,
      anomaly:     body.anomaly,
      anomalyNote,
      wouldReturn: body.wouldReturn,
    },
    update: {
      anomaly:     body.anomaly,
      anomalyNote,
      wouldReturn: body.wouldReturn,
    },
  })

  // Venue review — matched server-side from the event's location (the
  // client never picks the business). Create-only: if the member
  // already has a review for this business (including from a survey
  // retry in the same window), leave it untouched. Best-effort — a
  // failure here must not lose the survey response.
  if (venueRating !== null) {
    try {
      const venue = await matchDirectoryVenue(event.location)
      if (venue) {
        const already = await prisma.businessReview.findUnique({
          where:  { businessId_authorId: { businessId: venue.id, authorId: session.id } },
          select: { id: true },
        })
        if (!already) {
          await prisma.businessReview.create({
            data: {
              businessId: venue.id,
              authorId:   session.id,
              rating:     venueRating,
              comment:    venueComment || null,
            },
          })
        }
      }
    } catch (e) {
      console.error('Survey venue review create failed:', e)
    }
  }

  // Auto-file a Report when the responder flagged something off. The
  // Report points at the host as the responsible party — admins read
  // the anomalyNote and route the action (warn host, follow up with
  // the actual offender if named, etc.). reporterId stays the
  // responder; the surface that renders Reports never exposes the
  // reporter to the host.
  if (body.anomaly && event.hostId && event.hostId !== session.id) {
    await prisma.report.create({
      data: {
        reporterId: session.id,
        reportedId: event.hostId,
        eventId:    event.id,
        reason:     'post_event_survey',
        details:    `Survey response on "${event.title}" (${event.date}): ${anomalyNote || '(no details provided)'}`,
        status:     'pending',
      },
    })

    // Push the moderators so a serious anomaly doesn't sit in a queue
    // unnoticed. Best-effort — failure must not block the survey
    // response from being recorded.
    prisma.user.findMany({
      where:  { role: { in: ['admin', 'moderator'] } },
      select: { id: true },
    }).then(mods => Promise.all(mods.map(m =>
      createNotification(m.id, 'report_alert',
        '⚠️ Anomaly reported in post-event survey',
        `Someone flagged "${event.title}" — review the report`,
        '/admin/moderation',
      ),
    ))).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}

// Match the event's venue to an approved directory listing by name —
// the same convention the event page's "View in directory" chip uses,
// kept in sync by scripts/import-event-venues.ts.
async function matchDirectoryVenue(location: string | null) {
  const name = (location ?? '').replace(/\s+/g, ' ').trim()
  if (!name) return null
  return prisma.business.findFirst({
    where:  { name: { equals: name, mode: 'insensitive' }, isApproved: true, isActive: true },
    select: { id: true, name: true },
  })
}

// Best-guess "when did this event end" timestamp. Event.endTime is
// optional ("HH:MM"). When missing, treat the event as ending at
// 23:59 on its date so the survey doesn't fire prematurely on
// late-evening events that didn't set an end time.
function endTimestamp(date: string, endTime: string | null): number {
  const time = endTime?.match(/^(\d{1,2}):(\d{2})/) ? endTime : '23:59'
  return new Date(`${date}T${time}:00+03:00`).getTime()  // Istanbul timezone
}
