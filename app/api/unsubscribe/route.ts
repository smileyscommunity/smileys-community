import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyUnsubscribeToken } from '@/lib/unsubscribe'

export async function GET(req: NextRequest) {
  const uid   = req.nextUrl.searchParams.get('uid') ?? ''
  const token = req.nextUrl.searchParams.get('t')   ?? ''

  if (!uid || !token || !verifyUnsubscribeToken(uid, token)) {
    return NextResponse.redirect(new URL('/app/unsubscribe?error=1', req.url))
  }

  await prisma.user.update({
    where: { id: uid },
    data:  { emailMarketing: false },
  })

  return NextResponse.redirect(new URL('/app/unsubscribe?done=1', req.url))
}
