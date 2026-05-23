import { canManageUsers, canViewUserList } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { writeAudit, getDiff } from '@/lib/audit'

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session || !canViewUserList(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const params = new URL(req.url).searchParams
    const search = params.get('search') ?? ''
    const status = params.get('status') ?? ''

    const users = await prisma.user.findMany({
      where: {
        ...(status && { status }),
        ...(search && {
          OR: [
            { name:  { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: { joinedAt: 'desc' },
      select: {
        id: true, name: true, email: true, role: true,
        color: true, emailVerified: true, joinedAt: true,
        status: true, banReason: true, bannedAt: true, warningCount: true,
        appealNote: true, appealStatus: true, appealedAt: true,
        lastActive: true, phone: true, password: true,
      },
    })

    const isAdmin = canManageUsers(session)
    const mapped = users.map(({ email, phone, password, ...u }) => {
      const displayEmail = isAdmin ? email : (email.split('@')[0].slice(0, 3) + '...@' + email.split('@')[1])
      const displayPhone = isAdmin ? phone : (phone ? phone.slice(0, 4) + '...' + phone.slice(-2) : null)
      return { ...u, email: displayEmail, phone: displayPhone, hasPassword: !!password }
    })
    return NextResponse.json(mapped)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getSession()
    if (!session || !canManageUsers(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id, role } = await req.json()
    if (!['admin', 'moderator', 'member'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    if (id === session.id) {
      return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 })
    }
    const before = await prisma.user.findUnique({ where: { id }, select: { role: true, name: true } })
    if (!before) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const user = await prisma.user.update({
      where: { id },
      data: { role },
      select: {
        id: true, name: true, email: true, role: true,
        color: true, emailVerified: true, joinedAt: true,
        status: true,
      },
    })

    const diff = getDiff(before, { role })
    if (diff) {
      writeAudit(session.id, session.name, 'user.update', id, 'user',
        { diff, name: before.name },
        `Changed role for ${before.name} to ${role}`
      )
    }

    return NextResponse.json(user)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

