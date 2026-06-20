import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyUnsubscribeToken } from '@/lib/unsubscribe'
import { rateLimit } from '@/lib/rateLimit'

export async function GET(req: NextRequest) {
  const ip  = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!await rateLimit(`unsub:${ip}`, 10, 60_000)) {
    return NextResponse.redirect(new URL('/unsubscribe?error=1', req.url))
  }

  const uid          = req.nextUrl.searchParams.get('uid') ?? ''
  const token        = req.nextUrl.searchParams.get('t')   ?? ''
  const newsletterId = req.nextUrl.searchParams.get('nl')  ?? ''

  if (!uid || !token || !verifyUnsubscribeToken(uid, token)) {
    return NextResponse.redirect(new URL('/unsubscribe?error=1', req.url))
  }

  try {
    await prisma.user.update({
      where: { id: uid },
      data:  { emailMarketing: false },
    })
    if (newsletterId) {
      await prisma.newsletter.update({
        where: { id: newsletterId },
        data:  { unsubscribeCount: { increment: 1 } },
      }).catch(() => {})
    }
  } catch {
    return NextResponse.redirect(new URL('/unsubscribe?error=1', req.url))
  }

  return NextResponse.redirect(new URL('/unsubscribe?done=1', req.url))
}
