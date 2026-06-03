import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit } from '@/lib/rateLimit'

type Params = { params: Promise<{ id: string }> }

// DELETE /api/auth/sessions/[id] — revoke a specific session row.
// Scoped to the caller: you can only revoke sessions you own. Setting
// `revokedAt` (rather than hard-deleting) makes the next request from
// that device fail the freshness check in getSession() and clears its
// cookie cleanly — and leaves an audit trail if we ever surface "last
// revoked at" in /settings.

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`session-revoke:${session.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many revocations. Try again in a minute.' }, { status: 429 })
  }

  const { id } = await params

  // Ownership gate. Without this, anyone could revoke any session by
  // guessing IDs — IDOR on the session table itself.
  const row = await prisma.session.findUnique({
    where: { id },
    select: { userId: true, revokedAt: true },
  })
  if (!row || row.userId !== session.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (row.revokedAt) return NextResponse.json({ ok: true })

  await prisma.session.update({
    where: { id },
    data:  { revokedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
