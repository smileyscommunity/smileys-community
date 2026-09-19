import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, createSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

// GET /api/auth/sessions — list every active session for the caller.
// Powers the "Active devices" section in /settings so users can spot a
// rogue device (cookie theft, shared computer, etc.) and revoke it.

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await rateLimit(`sessions-list:${session.id}`, 60, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const rows = await prisma.session.findMany({
    where: {
      userId:    session.id,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { lastUsedAt: 'desc' },
    select: {
      id:         true,
      userAgent:  true,
      ip:         true,
      createdAt:  true,
      lastUsedAt: true,
      expiresAt:  true,
    },
  })

  const out = rows.map(r => ({
    id:         r.id,
    userAgent:  r.userAgent,
    ip:         r.ip,
    createdAt:  r.createdAt,
    lastUsedAt: r.lastUsedAt,
    expiresAt:  r.expiresAt,
    // Mark which row corresponds to the device making this request — the
    // UI dims the "Revoke" button on this one because revoking the
    // current session is what /logout does.
    current:    r.id === session.sessionId,
  }))

  return NextResponse.json({ sessions: out })
}

// POST — sign out everywhere else. A member who thinks someone else is in
// their account shouldn't have to revoke devices one at a time, and a
// legacy session carrying no id can't be revoked individually at all.
// Keeps the browser asking, and takes every other device's push with it.
export async function POST() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await rateLimit(`sessions-revoke-all:${session.id}`, 10, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const keep = session.sessionId
  const [revoked] = await prisma.$transaction([
    prisma.session.updateMany({
      where: { userId: session.id, revokedAt: null, ...(keep ? { id: { not: keep } } : {}) },
      data:  { revokedAt: new Date() },
    }),
    // A pending email change is refused at the new tokenVersion anyway, so
    // the row would only keep the settings page claiming one is waiting.
    prisma.emailVerificationToken.deleteMany({ where: { userId: session.id, newEmail: { not: null } } }),
    // Everything but this device's. A row with no session (registered
    // before the column existed) can't be attributed, so it goes too —
    // "everywhere else" has to mean it.
    prisma.pushSubscription.deleteMany({
      where: keep
        ? { userId: session.id, OR: [{ sessionId: null }, { sessionId: { not: keep } }] }
        : { userId: session.id },
    }),
  ])

  // Sessions issued before the per-device rows existed carry no id, so
  // revoking rows can't reach them; bumping tokenVersion can. It ends this
  // browser's JWT too, so it is re-issued at the new version below.
  const { tokenVersion } = await prisma.user.update({
    where:  { id: session.id },
    data:   { tokenVersion: { increment: 1 } },
    select: { tokenVersion: true },
  })
  await createSession({ ...session, tokenVersion }, {
    ...(keep ? { reuseSessionId: keep } : {}),
    totpVerified: session.totpVerified,
  })

  return NextResponse.json({ ok: true, revoked: revoked.count })
}
