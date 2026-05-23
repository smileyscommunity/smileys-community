import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createSession } from '@/lib/session'
import { jwtVerify } from 'jose'
import { verifySync } from 'otplib/functional'
import { rateLimit, getIp } from '@/lib/rateLimit'

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set')
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET)

export async function POST(req: NextRequest) {
  if (!await rateLimit(`2fa:${getIp(req)}`, 5, 15 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  const { code } = await req.json()
  if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 })

  const pending = req.cookies.get('smileys_2fa_pending')?.value
  if (!pending) return NextResponse.json({ error: 'Session expired — please log in again' }, { status: 401 })

  let userId: string
  try {
    const { payload } = await jwtVerify(pending, SECRET)
    if (!payload.pending2fa || typeof payload.userId !== 'string') throw new Error()
    userId = payload.userId
  } catch {
    return NextResponse.json({ error: 'Session expired — please log in again' }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, color: true, bio: true,
              neighborhood: true, instagram: true, emailVerified: true, partnerId: true,
              totpSecret: true, totpEnabled: true, tokenVersion: true },
  })
  if (!user?.totpEnabled || !user.totpSecret) {
    return NextResponse.json({ error: 'Session expired — please log in again' }, { status: 401 })
  }

  const result = verifySync({ token: String(code), secret: user.totpSecret, strategy: 'totp' } as any)
  if (!(result as any).valid) {
    return NextResponse.json({ error: 'Invalid code — check your authenticator app' }, { status: 400 })
  }

  const isClubHost = await prisma.clubMembership.count({
    where: { userId: user.id, status: 'approved', role: 'host' },
  }) > 0

  const initials = user.name.trim().split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)

  await Promise.all([
    createSession({ id: user.id, name: user.name, email: user.email, role: user.role,
                    color: user.color, partnerId: user.partnerId || undefined, tokenVersion: user.tokenVersion }),
    prisma.user.update({ where: { id: user.id }, data: { lastActive: new Date() } }),
  ])

  const res = NextResponse.json({
    id: user.id, name: user.name, email: user.email, role: user.role,
    color: user.color, initials, bio: user.bio, neighborhood: user.neighborhood,
    instagram: user.instagram, emailVerified: user.emailVerified, isClubHost,
    partnerId: user.partnerId,
  })
  res.cookies.set('smileys_2fa_pending', '', { maxAge: 0, path: '/' })
  return res
}
