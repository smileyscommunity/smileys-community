import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

// Mirrors BoardHub's ALERT_CATS — was missing WANTED/PETS/MOVING (added
// to the UI toggle list later), so toggling those alerts silently never
// persisted: the PATCH below filtered them straight back out.
const VALID = ['ROOMS', 'JOBS', 'SERVICES', 'BUY_SELL', 'FREE', 'RECO', 'WANTED', 'PETS', 'MOVING']

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { listingAlerts: true },
  })
  return NextResponse.json({ listingAlerts: user?.listingAlerts ?? [] })
}

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // One toggle per tap in the UI; bounded so a script can't hammer the user row.
  if (!await rateLimit(`listing-alerts:${session.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const { listingAlerts } = await req.json().catch(() => ({}))
  if (!Array.isArray(listingAlerts)) return NextResponse.json({ error: 'Invalid' }, { status: 400 })

  const filtered = (listingAlerts as string[]).filter(c => VALID.includes(c))
  await prisma.user.update({ where: { id: session.id }, data: { listingAlerts: filtered } })
  return NextResponse.json({ listingAlerts: filtered })
}
