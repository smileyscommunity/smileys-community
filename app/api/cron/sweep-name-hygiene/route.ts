import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fixNameCasing } from '@/lib/data'
import { recordCronRun } from '@/lib/cronHealth'
import { deleteExpiredAuthTokens, deleteStaleConnectionRequests, findStrandedApprovals } from '@/lib/hygieneSweeps'

// Nightly name-hygiene sweeper. The write path (register + profile PATCH)
// runs formatName, which fixes lowercase-first-letter words but deliberately
// leaves ALL-CAPS words alone — de-shouting needs the member's nationality
// to pick a casing locale (Turkish dotted/dotless i), and formatName doesn't
// have it. This sweep does: it re-cases every member's name with
// fixNameCasing(name, nationality) and persists whatever changed.
//
// Guarded per-row on the current name (updateMany with name in the WHERE)
// so a member self-editing mid-sweep always wins. Idempotent — a second run
// finds nothing to fix.
//
// Auth: requires `Authorization: Bearer <CRON_SECRET>`. If CRON_SECRET is
// unset, the endpoint refuses with 503 so a misconfigured prod doesn't
// silently leave the sweeper open to the internet.

export const dynamic = 'force-dynamic'

// Cron secret check delegated to lib/cronAuth.ts so the comparison is
// constant-time (timingSafeEqual) instead of `!==`. See that file for
// the rationale.
import { checkCronAuth } from '@/lib/cronAuth'

async function runSweep() {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, nationality: true },
  })

  const fixes: string[] = []
  for (const u of users) {
    const fixed = fixNameCasing(u.name, u.nationality)
    if (fixed === u.name) continue
    const res = await prisma.user.updateMany({
      where: { id: u.id, name: u.name },
      data:  { name: fixed },
    })
    if (res.count) fixes.push(`${u.name} → ${fixed}`)
  }

  if (fixes.length) console.log('[cron sweep-name-hygiene]', fixes.join('; '))

  // Two more nightly hygiene jobs ride on this sweep rather than new crons
  // (see lib/hygieneSweeps). Counts go FIRST in the summary: the cron wrapper
  // logs only the first 300 characters and `fixes` can be long.
  const expiredTokens = await deleteExpiredAuthTokens()
  const staleConnectionRequests = await deleteStaleConnectionRequests()
  if (expiredTokens.passwordReset || expiredTokens.staleActivation || expiredTokens.emailVerification || staleConnectionRequests) {
    console.log('[cron sweep-name-hygiene] deleted', { expiredTokens, staleConnectionRequests })
  }

  // Reported, never repaired — see findStrandedApprovals for why a sweeper
  // must not hand out access. An error line rather than a log one: this means
  // somebody was admitted and cannot get in, which is worth waking up to.
  //
  // And isolated: this is a diagnostic riding on a sweep that does real work
  // (name casing, expired tokens, stale connection requests). If the check
  // throws, that work is already done and must still be reported as done —
  // a monitor must not be able to fail the thing it monitors. Its own failure
  // surfaces as a null count rather than a silent zero, so "we didn't look"
  // never reads as "nothing to find".
  let stranded: { count: number; userIds: string[] } | null = null
  try {
    stranded = await findStrandedApprovals()
    if (stranded.count) {
      console.error('[cron sweep-name-hygiene] approved applicants whose account is still pending', stranded)
    }
  } catch (e) {
    console.error('[cron sweep-name-hygiene] stranded-approval check failed (sweep itself is fine)', e)
  }

  return { expiredTokens, staleConnectionRequests, strandedApprovals: stranded ? stranded.count : null, scanned: users.length, fixed: fixes.length, fixes }
}

export async function POST(req: NextRequest) {
  const denied = await checkCronAuth(req)
  if (denied) return denied

  try {
    const result = await runSweep()
    await recordCronRun('sweep-name-hygiene', true)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-name-hygiene]', e)
    await recordCronRun('sweep-name-hygiene', false, e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}

// No GET handler: the old "?key=<CRON_SECRET>" browser-testing path put
// the secret in query strings (nginx access logs, browser history) — the
// same class as the 2026-08 DB-password-in-crontab incident. Test with:
//   curl -X POST -H "x-cron-secret: $CRON_SECRET" <url>
