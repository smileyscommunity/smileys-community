import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Public listing of cities that accept applications today. Paused
// cities are filtered out so the apply form doesn't surface a city
// nobody can join. Status carried through so a "Launching ✦" badge
// can render next to early-stage cities once the front-end wants it.
export async function GET() {
  const cities = await prisma.city.findMany({
    where:   { status: { in: ['live', 'launching'] } },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],  // live before launching, then alphabetical
    select:  { slug: true, name: true, country: true, status: true },
  })
  return NextResponse.json(cities)
}
