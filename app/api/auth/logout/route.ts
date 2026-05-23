import { NextResponse } from 'next/server'
import { getSession, deleteSession, revokeAllSessions } from '@/lib/session'

export async function POST() {
  const session = await getSession()
  if (session) {
    await revokeAllSessions(session.id)
  } else {
    await deleteSession()
  }
  return NextResponse.json({ ok: true })
}
