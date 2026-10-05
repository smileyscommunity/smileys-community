import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rateLimit, getIp } from '@/lib/rateLimit'
import { APP_URL } from '@/lib/env'

// The link in the application email: proves the address belongs to the
// person who applied (double opt-in, 2026-09-29). Until it is clicked the
// application is still reviewed, but it doesn't count against that email or
// phone and a rejection sends no email — so nobody can use someone else's
// address to lock them out or mail them. One use; the token is cleared.
export async function GET(req: NextRequest) {
  if (!await rateLimit(`apply-confirm:${getIp(req)}`, 30, 60 * 60_000)) {
    return NextResponse.redirect(`${APP_URL}/apply/confirmed?status=later`)
  }
  const token = req.nextUrl.searchParams.get('token')?.trim() ?? ''
  if (!/^[a-f0-9]{48}$/.test(token)) return NextResponse.redirect(`${APP_URL}/apply/confirmed?status=invalid`)
  const updated = await prisma.memberApplication.updateMany({
    where: { confirmToken: token, emailConfirmedAt: null },
    data:  { emailConfirmedAt: new Date(), confirmToken: null },
  })
  return NextResponse.redirect(`${APP_URL}/apply/confirmed?status=${updated.count > 0 ? 'ok' : 'invalid'}`)
}
