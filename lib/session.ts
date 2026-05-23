import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { prisma } from '@/lib/prisma'

if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET environment variable is not set')
const SECRET = new TextEncoder().encode(process.env.JWT_SECRET)
const COOKIE = 'smileys_session'

export interface SessionUser {
  id: string
  name: string
  email: string
  role: string
  color: string
  bio?: string
  neighborhood?: string
  instagram?: string
  emailVerified?: boolean
  partnerId?: string
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ user })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(SECRET)

  const cookieStore = await cookies()
  cookieStore.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(COOKIE)?.value
    if (!token) return null
    const { payload } = await jwtVerify(token, SECRET)
    const user = payload.user as SessionUser

    // Real-time ban/suspension check — prevents banned users from using valid tokens
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { status: true, suspendedUntil: true },
    })
    if (!dbUser || dbUser.status === 'banned') {
      await deleteSession()
      return null
    }
    if (dbUser.suspendedUntil && new Date(dbUser.suspendedUntil) > new Date()) {
      await deleteSession()
      return null
    }

    return user
  } catch {
    return null
  }
}

export async function deleteSession() {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE)
}
