import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator } from '@/lib/access'
import { seedCityClubs } from '@/lib/seedCityClubs'
import { CITY_STATUS } from '@/lib/cityStatus'
import { writeAudit } from '@/lib/audit'

type Params = { params: Promise<{ id: string }> }

// POST /api/admin/cities/[id]/launch-clubs — seed the city's starter club
// lineup from the shared template catalog. Idempotent (existing clubs are
// skipped), so it's safe to re-run after adding new templates.
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  // Moderators can only seed clubs for their own city.
  if (!isAdmin(session) && session.cityId !== id) {
    return NextResponse.json({ error: 'Cross-city club launch is admin-only' }, { status: 403 })
  }
  const city = await prisma.city.findUnique({ where: { id }, select: { slug: true, name: true, status: true } })
  if (!city) return NextResponse.json({ error: 'City not found' }, { status: 404 })

  // Seeding a city that's still `coming_soon` is how Izmir ended up with 11
  // clubs and no members — a template dump wearing a community's clothes,
  // which reads as abandoned rather than unstarted. `preparing` is the state
  // that exists for "hosts are setting this up and members can't see it yet",
  // so that's the earliest point starter clubs mean anything.
  if (city.status === CITY_STATUS.ComingSoon) {
    return NextResponse.json({
      error: `${city.name} is still Coming soon — move it to Preparing before seeding clubs, so the lineup arrives with hosts rather than sitting empty.`,
    }, { status: 400 })
  }

  try {
    const result = await seedCityClubs(prisma, city.slug)
    if (result.created > 0) {
      await writeAudit(session.id, session.name, 'city.clubs_launch', id, 'city',
        { city: city.name, created: result.created, activeCreated: result.activeCreated, skipped: result.skipped, slugs: result.createdSlugs },
        `Launched ${result.created} starter club(s) in ${city.name} (${result.activeCreated} active)`,
      )
    }
    return NextResponse.json(result)
  } catch (e) {
    console.error('[launch-clubs]', e)
    return NextResponse.json({ error: 'Failed to seed clubs' }, { status: 500 })
  }
}
