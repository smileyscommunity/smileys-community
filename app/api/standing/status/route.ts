import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { memberStanding } from '@/lib/standing'

// The signed-in member's own standing — nobody else's. Reports nothing until
// standing is switched on (lib/standing memberStanding).
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  try {
    return NextResponse.json(await memberStanding(session.id))
  } catch (e) {
    console.error('[standing status]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
