import { NextRequest, NextResponse } from 'next/server'
import { getEvents } from '@/lib/db'
import { getSession } from '@/lib/session'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const limit    = Math.min(parseInt(searchParams.get('limit')  ?? '24'), 100)
  const offset   = Math.max(parseInt(searchParams.get('offset') ?? '0'),  0)
  const upParam  = searchParams.get('upcoming')
  const upcoming = upParam === '1' ? true : upParam === '0' ? false : undefined

  // City scoping for the events feed.
  //
  //   - `?city=<slug>` — explicit override (used by event discovery
  //     pages that show a specific city's calendar).
  //   - `?all=1` — show events across every city (traveller view).
  //   - Default: scope to the viewer's own cityId so a Berlin member
  //     doesn't see Istanbul events cluttering their feed.
  //   - Logged-out viewers see Istanbul-or-no-filter via no session;
  //     keep the behaviour simple by not filtering when no city is
  //     resolved.
  let cityId: string | undefined
  if (searchParams.get('all') !== '1') {
    const slug = searchParams.get('city')?.trim()
    if (slug) {
      const { prisma } = await import('@/lib/prisma')
      const c = await prisma.city.findUnique({ where: { slug }, select: { id: true } })
      cityId = c?.id
    } else {
      const session = await getSession()
      cityId = session?.cityId
    }
  }

  const { events, total } = await getEvents({ limit, offset, upcoming, cityId })
  return NextResponse.json({ events, total, hasMore: offset + events.length < total })
}
