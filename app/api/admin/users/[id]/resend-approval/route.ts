import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManageUsers } from '@/lib/access'
import { sendActivationEmail } from '@/lib/email'
import { randomBytes } from 'crypto'

type Params = { params: Promise<{ id: string }> }

export async function POST(_: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    if (!session || !canManageUsers(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await params
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, password: true, status: true },
    })

    if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (user.status !== 'approved') return NextResponse.json({ error: 'User is not approved' }, { status: 400 })
    if (user.password) return NextResponse.json({ error: 'User has already set a password' }, { status: 400 })

    // Invalidate any existing tokens
    await prisma.passwordResetToken.deleteMany({ where: { userId: id } })

    // Generate new activation token (7 days)
    const token     = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await prisma.passwordResetToken.create({ data: { userId: id, token, expiresAt } })

    await sendActivationEmail(user.email, user.name ?? 'Member', token)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
