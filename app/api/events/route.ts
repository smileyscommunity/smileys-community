import { NextRequest, NextResponse } from 'next/server'
import { getEvents, redactEventForGuest } from '@/lib/db'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'anon'
  if (!await rateLimit(`events:${ip}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
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
  // Resolved once: used both for default city-scoping and to decide
  // whether the viewer gets full events or the redacted guest projection.
  const session = await getSession()

  let cityId: string | undefined
  if (searchParams.get('all') !== '1') {
    const slug = searchParams.get('city')?.trim()
    if (slug) {
      const { prisma } = await import('@/lib/prisma')
      const c = await prisma.city.findUnique({ where: { slug }, select: { id: true } })
      cityId = c?.id
    } else {
      cityId = session?.cityId
    }
  }

  const { events, total } = await getEvents({ limit, offset, upcoming, cityId })
  // Logged-out viewers get the public teaser: no exact address/GPS, no
  // chat/meeting links, no attendee identities (the "X going" count stays).
  const projected = session ? events : events.map(redactEventForGuest)
  return NextResponse.json({ events: projected, total, hasMore: offset + events.length < total })
}
