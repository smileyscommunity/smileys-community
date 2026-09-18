import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rateLimit'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canActInCity } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { safeNeighborhoodFor } from '@/lib/neighborhoodsDb'
import { HANGOUT_ACTIVITIES } from '@/lib/hangoutActivities'
import { MAX_HANGOUT_LEAD_DAYS } from '@/lib/hangoutTime'

// Edit a hangout. Host or staff only, active hangouts only.
//
// Photo semantics: `photo` absent = unchanged, a valid upload URL =
// add/replace, explicit null = remove. Joiners are notified only when a
// field that affects showing up changes (title / location / times) —
// photo or description tweaks stay silent so hosts can polish the card
// without spamming everyone who already joined.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Every material edit fans out to the joiners.
  if (!await rateLimit(`hangout-edit:${session.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many edits — slow down' }, { status: 429 })
  }

  const { id } = await params
  const hangout = await prisma.hangout.findUnique({
    where: { id },
    include: { joins: { select: { userId: true } } },
  })
  if (!hangout) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Staff override is city-scoped (lib/access canActInCity): the 2026-09-03
  // moderator sweep missed these two handlers.
  if (hangout.userId !== session.id && !canActInCity(session, hangout.cityId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (hangout.status !== 'active') {
    return NextResponse.json({ error: 'Only active hangouts can be edited' }, { status: 400 })
  }

  const body = (await req.json().catch(() => null)) ?? {}
  const { title, description, location, neighborhood, startsAt, endsAt, meetMode, photo, activity, maxPeople } = body

  // Same validation rules as POST /api/hangouts — a field arrives either
  // absent (keep current) or valid (replace).
  const data: Record<string, unknown> = {}

  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim() || title.length > 120) return NextResponse.json({ error: 'Invalid title' }, { status: 400 })
    data.title = title.trim().slice(0, 120)
  }
  if (description !== undefined) {
    if (description && (typeof description !== 'string' || description.length > 500)) {
      return NextResponse.json({ error: 'Description too long' }, { status: 400 })
    }
    data.description = typeof description === 'string' ? description.trim().slice(0, 500) || null : null
  }
  if (location !== undefined) {
    if (typeof location !== 'string' || !location.trim() || location.length > 200) return NextResponse.json({ error: 'Invalid location' }, { status: 400 })
    data.location = location.trim().slice(0, 200)
  }
  if (neighborhood !== undefined) {
    // Validated against the HANGOUT's city — an edit never re-scopes the
    // record to the editor's city.
    data.neighborhood = await safeNeighborhoodFor(hangout.cityId, neighborhood)
  }

  if (startsAt !== undefined || endsAt !== undefined) {
    const startDate = startsAt !== undefined ? new Date(startsAt) : hangout.startsAt
    const endDate   = endsAt   !== undefined ? new Date(endsAt)   : hangout.endsAt
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }
    if (endDate <= startDate) return NextResponse.json({ error: 'End must be after start' }, { status: 400 })
    if (endDate.getTime() - startDate.getTime() > 24 * 60 * 60 * 1000) {
      return NextResponse.json({ error: 'Max 24 hours per hangout' }, { status: 400 })
    }
    if (endDate < new Date()) return NextResponse.json({ error: 'End is in the past' }, { status: 400 })
    if (startDate.getTime() > Date.now() + MAX_HANGOUT_LEAD_DAYS * 86_400_000) {
      return NextResponse.json({ error: `Hangouts are for the next ${MAX_HANGOUT_LEAD_DAYS} days` }, { status: 400 })
    }
    data.startsAt = startDate
    data.endsAt   = endDate
    // A moved start gets its own 30-minute ping: the sweeper only pings
    // rows with notifiedStartingAt null, so a hangout pushed back two hours
    // after the first ping left joiners with a "leave now" for the old time.
    if (startDate.getTime() !== hangout.startsAt.getTime()) data.notifiedStartingAt = null
  }

  if (meetMode !== undefined) {
    data.meetMode = meetMode === 'solo' ? 'solo' : 'group'
  }
  if (activity !== undefined) {
    data.activity = typeof activity === 'string' && (HANGOUT_ACTIVITIES as readonly { value: string }[]).some(a => a.value === activity) ? activity : null
  }
  if (maxPeople !== undefined) {
    // null / 0 lifts the cap. A cap under the people already in is refused —
    // nobody is thrown out by an edit.
    const cap = maxPeople === null || maxPeople === 0 ? null : maxPeople
    if (cap !== null && (!Number.isInteger(cap) || cap < 2 || cap > 10)) return NextResponse.json({ error: 'Capacity is 2–10, or none' }, { status: 400 })
    if (cap !== null && cap < hangout.joins.length + 1) return NextResponse.json({ error: `${hangout.joins.length + 1} people are already in — the cap can't go below that` }, { status: 400 })
    data.maxPeople = cap
  }

  if (photo !== undefined) {
    // Same regex as the create route / DM attachments — only our own
    // upload-output paths, never a smuggled remote URL.
    if (photo === null) data.photo = null
    else if (typeof photo === 'string' && isUploadedImageUrl(photo)) data.photo = photo
    else return NextResponse.json({ error: 'Invalid photo URL' }, { status: 400 })
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const updated = await prisma.hangout.update({ where: { id }, data })

  // "Show-up relevant" changes → tell everyone who joined, so nobody
  // arrives at the old time or place.
  // A title tweak is not a reason to leave the house; where and when are.
  const materialChange =
    (data.location !== undefined && data.location !== hangout.location) ||
    (data.neighborhood !== undefined && data.neighborhood !== hangout.neighborhood) ||
    (data.startsAt !== undefined && (data.startsAt as Date).getTime() !== hangout.startsAt.getTime()) ||
    (data.endsAt   !== undefined && (data.endsAt   as Date).getTime() !== hangout.endsAt.getTime())
  if (materialChange) {
    for (const j of hangout.joins) {
      if (j.userId === session.id) continue
      createNotification(
        j.userId,
        'hangout_updated',
        `✏️ Plan changed`,
        `"${updated.title}" was updated — check the new details before heading out`,
        `/hangouts/${id}`,
      ).catch(() => {})
    }
  }

  return NextResponse.json({ hangout: updated })
}

// Cancel a hangout. Host or staff only.
//
// Notifies every joiner that the hangout is off — without this push, joiners
// would silently show up to nothing because the only signal was the card
// disappearing from the feed (and most won't refresh between joining and
// leaving home).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const hangout = await prisma.hangout.findUnique({
    where: { id },
    include: {
      user:  { select: { id: true, name: true } },
      joins: { select: { userId: true } },
    },
  })
  if (!hangout) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isStaff = canActInCity(session, hangout.cityId)
  if (hangout.userId !== session.id && !isStaff) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // A hangout that already ran its course stays on the record: a cancel
  // after the fact erased its no-show references from the recount. Staff can
  // still take one down.
  if (hangout.status === 'active' && hangout.endsAt < new Date() && !isStaff) {
    return NextResponse.json({ error: 'This hangout has already ended and can no longer be cancelled' }, { status: 409 })
  }

  // Only notify if hangout was actually active — re-cancellation noop should
  // not re-spam joiners.
  const wasActive = hangout.status === 'active'

  await prisma.hangout.update({ where: { id }, data: { status: 'cancelled' } })

  if (wasActive) {
    const cancelledBy = session.id === hangout.userId ? hangout.user.name : 'a moderator'
    for (const j of hangout.joins) {
      // Don't notify the canceller themselves (e.g. host cancels — they know).
      if (j.userId === session.id) continue
      createNotification(
        j.userId,
        'hangout_cancelled',
        `❌ Hangout cancelled`,
        `${cancelledBy} cancelled "${hangout.title}" — check the feed for other plans`,
        // Deep-link to the permalink so the joiner sees the cancellation
        // banner instead of just landing on a feed that no longer
        // contains the hangout (which reads as "did I imagine that?").
        `/hangouts/${id}`,
      ).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true })
}
