import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

/**
 * Constant-time check of `Authorization: Bearer <CRON_SECRET>` for cron
 * routes. Returns a NextResponse to return immediately if auth fails, or
 * null if it passes.
 *
 * Without timing-safe comparison a `===` against a long secret leaks a few
 * bytes of timing information per request — impractical to exploit at scale
 * but trivial to harden.
 *
 * Fails closed if `CRON_SECRET` env var is unset (503), preventing every
 * cron from running open to the internet when env config is wrong.
 */
export function checkCronAuth(req: Request): NextResponse | null {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured on server' },
      { status: 503 },
    )
  }
  const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}
