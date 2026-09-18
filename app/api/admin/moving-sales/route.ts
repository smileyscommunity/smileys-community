import { NextResponse } from 'next/server'
import { maskRows } from '@/lib/admin/maskContact'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator, failClosedCityId } from '@/lib/access'
import { todayInTz } from '@/lib/cityTime'

// Admin list — unlike the public GET (which only shows active,
// non-expired sales, capped at 30), this surfaces everything so staff can
// find and remove a bad post regardless of status or expiry. Removal
// itself reuses the existing owner/staff PATCH at /api/moving-sales/[id]
// (already checks isAdminOrModerator) — no new mutation endpoint needed.
export async function GET() {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const found = await prisma.movingSale.findMany({
      // Moderators: their own city's sales. Admins: all.
      where:   isAdmin(session) ? {} : { cityId: failClosedCityId(session) },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, leavingOn: true, neighborhood: true, note: true, photo: true, status: true, createdAt: true,
        user:  { select: { id: true, name: true, email: true, color: true } },
        city:  { select: { name: true, slug: true, timezone: true } },
        items: { select: { id: true, name: true, price: true, claimed: true } },
      },
    })
    // leavingOn is also the expiry: the public list drops a sale once that
    // day is behind its city, but nothing flips its status, so the admin
    // "active" tab kept showing sales members could no longer see. `expired`
    // is judged here, on each sale's own city calendar — leavingOn is a bare
    // 'YYYY-MM-DD', so it compares as a string against that city's today.
    const todayByTz = new Map<string, string>()
    const todayFor = (tz: string) => {
      let t = todayByTz.get(tz)
      if (!t) { t = todayInTz(tz); todayByTz.set(tz, t) }
      return t
    }
    const sales = found.map(({ city, ...s }) => ({
      ...s,
      city:    { name: city.name, slug: city.slug },
      expired: s.leavingOn < todayFor(city.timezone),
    }))
    return NextResponse.json({ sales: maskRows(session, sales, 'user') })
  } catch (e) {
    console.error('Admin moving-sales GET error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
