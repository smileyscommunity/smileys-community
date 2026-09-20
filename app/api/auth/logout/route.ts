import { NextResponse } from 'next/server'
import { getSession, deleteSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

export async function POST() {
  // Sign out THIS device only — deletes the current session (its jti row +
  // cookie). Previously this called revokeAllSessions, which bumped
  // tokenVersion and killed every other device too (phone, other browsers),
  // contradicting the per-device session model. "Sign out everywhere" is a
  // separate, explicit action in settings.
  //
  // Its push registration goes with it. The client tears that down too
  // (lib/pushDevice forgetPushDevice), but that runs in a browser that may be
  // offline, have no service worker, or be closed before it finishes — and
  // what's left behind is a phone that keeps buzzing with the departing
  // member's message previews. Signing a device out from /settings has always
  // done this server-side; doing it here too costs one delete.
  const session = await getSession()
  if (session?.sessionId) {
    await prisma.pushSubscription.deleteMany({
      where: { userId: session.id, sessionId: session.sessionId },
    }).catch(() => {})
  }
  await deleteSession()
  return NextResponse.json({ ok: true })
}
