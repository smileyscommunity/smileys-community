import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkCronAuth } from '@/lib/cronAuth'
import { recordCronRun } from '@/lib/cronHealth'
import { sendLoginNudgeEmail, recordEmailFailure } from '@/lib/email'
import { randomBytes } from 'crypto'
import { hashToken } from '@/lib/tokenHash'

// POST /api/cron/sweep-login-nudge
//
// Finds approved members who have never logged in and sends them a
// gentle reminder with a fresh activation link. Runs daily via cron.
//
// Rules:
//  - User must be approved, have no password set, and lastActive IS NULL
//  - Approved at least 3 days ago (give them time to see the first email)
//  - No more than 2 nudges total per user
//  - At least 7 days between nudges
//  - Stop nudging after 60 days from approval

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const fail = checkCronAuth(req)
  if (fail) return fail

  try {
    const now        = new Date()
    const minAge     = new Date(now.getTime() - 3  * 24 * 60 * 60 * 1000)  // approved 3+ days ago
    const maxAge     = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)  // stop after 60 days
    const nudgeCool  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000)  // 7 days between nudges

    const candidates = await prisma.user.findMany({
      where: {
        status:      'approved',
        lastActive:  null,
        password:    null,           // never set a password = never completed activation
        nudgesSent:  { lt: 2 },     // max 2 nudges
        joinedAt:    { lte: minAge, gte: maxAge },
        OR: [
          { lastNudgedAt: null },
          { lastNudgedAt: { lte: nudgeCool } },
        ],
      },
      select: { id: true, name: true, email: true, nudgesSent: true, joinedAt: true },
      take: 50,                      // cap per run to avoid Resend rate limits
    })

    let sent = 0
    let failed = 0

    for (const user of candidates) {
      try {
        // Generate a fresh 7-day activation token
        await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } })
        const token     = randomBytes(32).toString('hex')
        const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        await prisma.passwordResetToken.create({
          data: { userId: user.id, token: hashToken(token), expiresAt },
        })

        const nudgeNumber = user.nudgesSent + 1
        await sendLoginNudgeEmail(user.email, user.name ?? 'Member', token, nudgeNumber)

        await prisma.user.update({
          where: { id: user.id },
          data:  { nudgesSent: nudgeNumber, lastNudgedAt: now },
        })

        sent++
      } catch (e) {
        failed++
        await recordEmailFailure({
          helper:    'sendLoginNudgeEmail',
          recipient: user.email,
          error:     e,
          context:   { userId: user.id },
        })
      }
    }

    await recordCronRun('sweep-login-nudge', true)
    return NextResponse.json({ ok: true, sent, failed, candidates: candidates.length })
  } catch (e) {
    await recordCronRun('sweep-login-nudge', false, e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
