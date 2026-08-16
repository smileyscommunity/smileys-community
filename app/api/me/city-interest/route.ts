import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { CITY_STATUS } from '@/lib/cityStatus'
import { trackServer } from '@/lib/posthog-server'

// "Tell me when this city opens", for members who already have an account.
//
// Sending them to /apply — the application form — for a pre-launch city asks an
// existing member to apply to Smileys all over again. Interest is the right
// shape: a signal, not a belonging, and it's the list to email on launch day.

export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const rows = await prisma.cityRelationship.findMany({
    where:  { userId: session.id, type: 'interested' },
    select: { city: { select: { slug: true } } },
  })
  return NextResponse.json({ slugs: rows.map(r => r.city.slug) })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
  if (!slug) return NextResponse.json({ error: 'City is required' }, { status: 400 })

  const city = await prisma.city.findUnique({
    where:  { slug },
    select: { id: true, name: true, status: true },
  })
  if (!city) return NextResponse.json({ error: 'City not found' }, { status: 404 })
  // A live city doesn't need a waiting list — joining it is the action.
  if (city.status === CITY_STATUS.Live) {
    return NextResponse.json({ error: `${city.name} is already open — you can join it now.` }, { status: 400 })
  }

  // Idempotent: pressing it twice is the same outcome, not a constraint
  // error. update:{} deliberately leaves an existing row's type alone — a
  // 'member' row (city has since gone live) must not regress to interest.
  const existing = await prisma.cityRelationship.findUnique({
    where:  { userId_cityId: { userId: session.id, cityId: city.id } },
    select: { userId: true },
  })
  await prisma.cityRelationship.upsert({
    where:  { userId_cityId: { userId: session.id, cityId: city.id } },
    create: { userId: session.id, cityId: city.id, type: 'interested' },
    update: {},
  })
  // First expression only — an idempotent re-press isn't a funnel event.
  if (!existing) trackServer(session, 'city_interest', { city: slug })
  return NextResponse.json({ ok: true, city: { slug, name: city.name } })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
  if (!slug) return NextResponse.json({ error: 'City is required' }, { status: 400 })

  const city = await prisma.city.findUnique({ where: { slug }, select: { id: true } })
  if (!city) return NextResponse.json({ error: 'City not found' }, { status: 404 })

  // Scoped to 'interested' — withdrawing interest must not silently remove
  // a membership in a city that has since gone live.
  await prisma.cityRelationship.deleteMany({ where: { userId: session.id, cityId: city.id, type: 'interested' } })
  return NextResponse.json({ ok: true })
}
