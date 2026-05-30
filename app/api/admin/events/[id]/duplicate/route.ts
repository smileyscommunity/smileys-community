import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { todayIstanbul } from '@/lib/data'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

// POST /api/admin/events/[id]/duplicate
//
// Clones an existing event into a new draft. Previously the admin list
// page's "Duplicate" button only inserted a client-side row with a fake
// id — reload lost it, and any Edit/Delete on the fake row 404'd. This
// endpoint persists the copy server-side so the action behaves the way
// the UI implied all along.
//
// Behaviour:
//   - title gets " (Copy)" appended
//   - date resets to today (source date is usually past or imminent)
//   - status starts as 'draft' so the admin can review before publishing
//   - spotsLeft resets to totalSpots (no inherited attendees / waitlist)
//   - seriesId is cleared — the copy is not a phantom member of the
//     source's recurring series
//   - cancelledAt / cancelReason cleared even if the source was killed
export async function POST(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const { id } = await params

    const source = await prisma.event.findUnique({ where: { id } })
    if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Pull every field except the ones we want to override or have
    // Prisma regenerate (id, createdAt, updatedAt).
    const {
      id: _id, createdAt: _c, updatedAt: _u,
      title, date: _date, status: _status, spotsLeft: _spotsLeft,
      seriesId: _series, isRecurring: _rec,
      cancelledAt: _ca, cancelReason: _cr,
      ...rest
    } = source

    const copy = await prisma.event.create({
      data: {
        ...rest,
        title:        `${title} (Copy)`,
        date:         todayIstanbul(),
        status:       'draft',
        spotsLeft:    source.totalSpots,
        seriesId:     null,
        isRecurring:  false,
        cancelledAt:  null,
        cancelReason: null,
      },
      include: {
        // host isn't a relation on Event (see schema — only `club`),
        // so the list API attaches it via a separate query. Mirror that
        // shape here so the prepended row renders identically.
        _count: { select: { attendees: true } },
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
