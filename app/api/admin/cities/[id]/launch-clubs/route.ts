import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { seedCityClubs } from '@/lib/seedCityClubs'

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
  const city = await prisma.city.findUnique({ where: { id }, select: { slug: true } })
  if (!city) return NextResponse.json({ error: 'City not found' }, { status: 404 })

  try {
    const result = await seedCityClubs(prisma, city.slug)
    return NextResponse.json(result)
  } catch (e) {
    console.error('[launch-clubs]', e)
    return NextResponse.json({ error: 'Failed to seed clubs' }, { status: 500 })
  }
}
