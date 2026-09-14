import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator, canActInCity } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { todayInCity } from '@/lib/city'
import { duplicateEventData } from '@/lib/eventDuplicate'

type Params = { params: Promise<{ id: string }> }

// POST /api/admin/events/[id]/duplicate
//
// Clones an existing event into a new draft. Previously the admin list
// page's "Duplicate" button only inserted a client-side row with a fake
// id — reload lost it, and any Edit/Delete on the fake row 404'd. This
// endpoint persists the copy server-side so the action behaves the way
// the UI implied all along.
//
// Behaviour: the copy is built from an explicit allow-list in
// lib/eventDuplicate — content is copied; title gets " (Copy)", date is today
// in the event's city, status is 'draft', seats/series/cancel state and every
// sweep stamp start fresh. It used to spread the source row, which carried
// noShowProcessedAt / surveyDispatchedAt into the copy so its no-show
// settlement and survey were silently skipped.
export async function POST(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params

    const source = await prisma.event.findUnique({ where: { id } })
    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // The copy lands in the source's city, so duplicating another city's
    // event IS creating an event there — same gate as any cross-city create.
    if (!canActInCity(session, source.cityId)) {
      return NextResponse.json({ error: 'Cross-city duplicate is admin-only' }, { status: 403 })
    }

    const copy = await prisma.event.create({
      // "Today" on the copy's own city clock — it lands in source.cityId, and
      // the viewer's city could already be a different calendar day.
      data: duplicateEventData(source, await todayInCity(source.cityId)),
      include: {
        // host isn't a relation on Event (see schema — only `club`),
        // so the list API attaches it via a separate query. Mirror that
        // shape here so the prepended row renders identically.
        _count: { select: { attendees: { where: { status: 'approved' } } } },
      },
    })

    const host = copy.hostId
      ? await prisma.user.findUnique({
          where:  { id: copy.hostId },
          select: { id: true, name: true, color: true, profilePhoto: true },
        })
      : null

    writeAudit(session.id, session.name, 'event.duplicate', copy.id, 'event',
      { sourceId: source.id, sourceTitle: source.title },
      `Duplicated "${source.title}" → "${copy.title}"`,
    )

    return NextResponse.json({ ...copy, host })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
