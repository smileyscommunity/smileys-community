import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { memberNoShowStatus } from '@/lib/noShow'

// The signed-in member's own no-show standing: the RSVP gate and any live
// cards. Feeds the banner and the /no-show page. Nothing about anyone else.
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  try {
    return NextResponse.json(await memberNoShowStatus(session.id))
  } catch (e) {
    console.error('[no-show status]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
