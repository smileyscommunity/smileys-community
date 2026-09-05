import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator, isAdmin, failClosedCityId } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { prisma } from '@/lib/prisma'
import { sendLoginNudgeEmail, recordEmailFailure } from '@/lib/email'
import { randomBytes } from 'crypto'
import { hashToken } from '@/lib/tokenHash'
import { writeAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!await rateLimit(`admin-login-nudge:${session.id}`, 3, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  try {
    const now       = new Date()
    const minAge    = new Date(now.getTime() - 3  * 24 * 60 * 60 * 1000)
    const maxAge    = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
    const nudgeCool = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000)

    const candidates = await prisma.user.findMany({
      where: {
        // Outbound mail: a moderator reaches their own city's members only.
        ...(isAdmin(session) ? {} : { cityId: failClosedCityId(session) }),
        status:     'approved',
        lastActive: null,
        password:   null,
        nudgesSent: { lt: 2 },
        joinedAt:   { lte: minAge, gte: maxAge },
        OR: [
          { lastNudgedAt: null },
          { lastNudgedAt: { lte: nudgeCool } },
        ],
      },
      select: { id: true, name: true, email: true, nudgesSent: true },
      take: 50,
    })

    let sent = 0, failed = 0
    for (const user of candidates) {
      try {
        await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } })
        const token     = randomBytes(32).toString('hex')
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        await prisma.passwordResetToken.create({ data: { userId: user.id, token: hashToken(token), expiresAt } })
        const nudgeNumber = user.nudgesSent + 1
        await sendLoginNudgeEmail(user.email, user.name ?? 'Member', token, nudgeNumber)
        await prisma.user.update({ where: { id: user.id }, data: { nudgesSent: nudgeNumber, lastNudgedAt: now } })
        sent++
      } catch (e) {
        failed++
        await recordEmailFailure({ helper: 'sendLoginNudgeEmail', recipient: user.email, error: e, context: { userId: user.id } })
      }
    }

    // A press that found nobody to nudge is not worth a row; a press that
    // emailed people is, whoever pressed it and whichever city they hold.
    if (candidates.length > 0) {
      await writeAudit(session.id, session.name, 'users.login_nudge', undefined, undefined,
        { sent, failed, candidates: candidates.length, ...(isAdmin(session) ? {} : { cityId: failClosedCityId(session) }) },
        `Sent login nudges to ${sent} members who never signed in (${failed} failed)`,
      )
    }

    return NextResponse.json({ ok: true, sent, failed, candidates: candidates.length })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
