import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { isAdminOrModerator, isAdmin, failClosedCityId } from '@/lib/access'
import { rateLimit, claimOnce, releaseClaim } from '@/lib/rateLimit'
import { prisma } from '@/lib/prisma'
import { sendLoginNudgeEmail, recordEmailFailure } from '@/lib/email'
import { randomBytes } from 'crypto'
import { hashToken } from '@/lib/tokenHash'
import { writeAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// A run emails at most 50 members one by one; ten minutes is well past that.
const RUN_CLAIM_MS    = 10 * 60_000
// The nudge cooldown: the same nudge number can't go to a member twice in it.
const MEMBER_CLAIM_MS = 7 * 24 * 60 * 60 * 1000

export async function POST() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!await rateLimit(`admin-login-nudge:${session.id}`, 3, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  // Two presses in flight (a double-click, a second tab, a retry after the
  // proxy timed out) both read the same never-nudged members before either
  // stamped lastNudgedAt, and each emailed them all. One run per audience at
  // a time: the duplicate gets 409, and the claim is handed back when the run
  // ends so a later press still works. The TTL only matters if the process
  // dies mid-run.
  const runKey = `admin-login-nudge-run:${isAdmin(session) ? 'all' : failClosedCityId(session)}`
  if (!await claimOnce(runKey, RUN_CLAIM_MS)) {
    return NextResponse.json({ error: 'A login nudge run is already in progress' }, { status: 409 })
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
      const nudgeNumber = user.nudgesSent + 1
      // Per member as well: an admin's network-wide run and a moderator's
      // city run hold different run claims but overlap on that city's members.
      const memberKey = `login-nudge:${user.id}:${nudgeNumber}`
      if (!await claimOnce(memberKey, MEMBER_CLAIM_MS)) continue
      let emailed = false
      try {
        await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } })
        const token     = randomBytes(32).toString('hex')
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        await prisma.passwordResetToken.create({ data: { userId: user.id, token: hashToken(token), expiresAt } })
        await sendLoginNudgeEmail(user.email, user.name ?? 'Member', token, nudgeNumber)
        emailed = true
        await prisma.user.update({ where: { id: user.id }, data: { nudgesSent: nudgeNumber, lastNudgedAt: now } })
        sent++
      } catch (e) {
        failed++
        // Nothing reached the member — give the claim back so the next run
        // can try. After the email went out the claim stays, even if the
        // stamp failed, or that run would send it again.
        if (!emailed) await releaseClaim(memberKey)
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
    console.error('[login-nudge tool]', e)
    return NextResponse.json({ error: 'Nudge run failed — see the server log' }, { status: 500 })
  } finally {
    await releaseClaim(runKey)
  }
}
