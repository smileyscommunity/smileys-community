import { NextResponse } from 'next/server'
import { deleteSession } from '@/lib/session'

export async function POST() {
  // Sign out THIS device only — deletes the current session (its jti row +
  // cookie). Previously this called revokeAllSessions, which bumped
  // tokenVersion and killed every other device too (phone, other browsers),
  // contradicting the per-device session model. "Sign out everywhere" is a
  // separate, explicit action in settings.
  await deleteSession()
  return NextResponse.json({ ok: true })
}
