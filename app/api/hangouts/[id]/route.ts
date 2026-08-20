import { NextRequest, NextResponse } from 'next/server'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { createNotification } from '@/lib/notify'
import { safeNeighborhoodFor } from '@/lib/neighborhoodsDb'

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

  const { id } = await params
  const hangout = await prisma.hangout.findUnique({
    where: { id },
    include: { joins: { select: { userId: true } } },
  })
  if (!hangout) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (hangout.userId !== session.id && !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (hangout.status !== 'active') {
    return NextResponse.json({ error: 'Only active hangouts can be edited' }, { status: 400 })
  }

  const { title, description, location, neighborhood, startsAt, endsAt, meetMode, photo } = await req.json()

  // Same validation rules as POST /api/hangouts — a field arrives either
  // absent (keep current) or valid (replace).
  const data: Record<string, unknown> = {}

  if (title !== undefined) {
    if (!title?.trim() || title.length > 120) return NextResponse.json({ error: 'Invalid title' }, { status: 400 })
    data.title = title.trim().slice(0, 120)
  }
  if (description !== undefined) {
    if (description && (typeof description !== 'string' || description.length > 500)) {
      return NextResponse.json({ error: 'Description too long' }, { status: 400 })
    }
    data.description = typeof description === 'string' ? description.trim().slice(0, 500) || null : null
  }
  if (location !== undefined) {
    if (!location?.trim() || location.length > 200) return NextResponse.json({ error: 'Invalid location' }, { status: 400 })
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
    data.startsAt = startDate
    data.endsAt   = endDate
  }

  if (meetMode !== undefined) {
    data.meetMode = meetMode === 'solo' ? 'solo' : 'group'
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
  const materialChange =
    (data.title    !== undefined && data.title    !== hangout.title) ||
    (data.location !== undefined && data.location !== hangout.location) ||
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

  if (hangout.userId !== session.id && !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
