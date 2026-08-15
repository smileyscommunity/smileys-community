import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { CITY_STATUS } from '@/lib/cityStatus'

// "Tell me when this city opens", for members who already have an account.
//
// Sending them to /apply — the application form — for a pre-launch city asks an
// existing member to apply to Smileys all over again. Interest is the right
// shape: a signal, not a belonging, and it's the list to email on launch day.

export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const rows = await prisma.cityInterest.findMany({
    where:  { userId: session.id },
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

  // Idempotent: pressing it twice is the same outcome, not a constraint error.
  await prisma.cityInterest.upsert({
    where:  { userId_cityId: { userId: session.id, cityId: city.id } },
    create: { userId: session.id, cityId: city.id },
    update: {},
  })
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

  await prisma.cityInterest.deleteMany({ where: { userId: session.id, cityId: city.id } })
  return NextResponse.json({ ok: true })
}
