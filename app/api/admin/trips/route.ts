import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { getTripReport } from '@/lib/tripReport'

// Cross-city trips, per trip: did the visit seed the city? (lib/tripReport).
// Admin-only for now — a trip spans two cities' staff, and the counts include
// who joined which city.
export async function GET() {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    return NextResponse.json({ trips: await getTripReport() })
  } catch (e) {
    console.error('[admin trips]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
