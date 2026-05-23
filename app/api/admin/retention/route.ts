import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

export async function GET() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const now       = new Date()
  const day7ago   = new Date(now.getTime() - 7  * 86400000)
  const day60ago  = new Date(now.getTime() - 60 * 86400000)
  const day60Str  = day60ago.toISOString().split('T')[0]

  // Never attended: approved members > 7 days old with 0 approved attendances
  const neverAttended = await prisma.user.findMany({
    where: {
      status: 'approved',
      joinedAt: { lt: day7ago },
      joinedEvents: { none: { status: 'approved' } },
    },
    select: {
      id: true, name: true, email: true, color: true, profilePhoto: true,
      neighborhood: true, interests: true, joinedAt: true,
    },
    orderBy: { joinedAt: 'desc' },
    take: 50,
  })

  // Dormant: attended at least once, but last event > 60 days ago
  const dormant = await prisma.$queryRaw<{
    id: string; name: string; email: string; color: string;
    neighborhood: string | null; lastEventDate: string; eventCount: number
  }[]>`
    SELECT u.id, u.name, u.email, u.color, u.neighborhood,
           MAX(e.date) as "lastEventDate",
           COUNT(ea.id)::int as "eventCount"
    FROM users u
    JOIN event_attendees ea ON ea."userId" = u.id AND ea.status = 'approved'
    JOIN events e ON e.id = ea."eventId"
    WHERE u.status = 'approved'
    GROUP BY u.id, u.name, u.email, u.color, u.neighborhood
    HAVING MAX(e.date) < ${day60Str}
    ORDER BY MAX(e.date) ASC
    LIMIT 50
  `

  return NextResponse.json({
    neverAttended,
    dormant,
    stats: {
      neverAttendedCount: neverAttended.length,
      dormantCount: dormant.length,
    },
  })
}
