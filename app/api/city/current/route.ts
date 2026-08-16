import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { resolveCityId, describeCity } from '@/lib/city'

// The city this request's feeds resolve to (view-city cookie → member's
// home city → default). Public. Page headers use it to name the city
// they're showing and to offer the "back to my city" switch: /api/events
// carries the same info inline, but endpoints with array-shaped responses
// (clubs) can't grow a field without breaking consumers, so their pages
// ask here instead.
export async function GET() {
  const session = await getSession()
  return NextResponse.json(await describeCity(await resolveCityId(session), session))
}
