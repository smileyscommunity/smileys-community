import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { fixNameCasing } from '@/lib/data'
import { recordCronRun } from '@/lib/cronHealth'

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
  return { scanned: users.length, fixed: fixes.length, fixes }
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

// GET allowed for easy manual testing from a browser when CRON_SECRET is
// passed as ?key=. Keeps prod debugging painless without exposing anything
// the POST doesn't.
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured on server' },
      { status: 503 },
    )
  }
  const key = req.nextUrl.searchParams.get('key') ?? ''
  // Constant-time comparison — see lib/cronAuth.ts.
  const a = Buffer.from(key)
  const b = Buffer.from(expected)
  const { timingSafeEqual } = await import('crypto')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runSweep()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[cron sweep-name-hygiene]', e)
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 })
  }
}
