import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession, deleteSession } from '@/lib/session'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'
import { rateLimit } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await rateLimit(`delete-account:${session.id}`, 3, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })
  }

  const { password } = await req.json()
  if (!password) return NextResponse.json({ error: 'Password is required' }, { status: 400 })

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { password: true, status: true },
  })
  if (!user || !user.password) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) return NextResponse.json({ error: 'Incorrect password' }, { status: 403 })

  // Anonymise PII — retain the account skeleton for data integrity
  // (event history, payment records, etc. are preserved but unlinked from identity)
  const ghost = `deleted_${randomBytes(6).toString('hex')}`
  await prisma.user.update({
    where: { id: session.id },
    data: {
      name:             'Deleted Member',
      email:            `${ghost}@deleted.smileys`,
      password:         randomBytes(32).toString('hex'), // unusable password
      bio:              null,
      profilePhoto:     null,
      instagram:        null,
      linkedin:         null,
      phone:            null,
      neighborhood:     null,
      nationality:      null,
      languages:        [],
      interests:        [],
      lookingFor:       [],
      color:            '#9ca3af',
      status:           'banned',     // prevents login
      referralCode:     null,
      // Status: banned is what currently evicts the session in getSession(),
      // but bump tokenVersion too so revocation is consistent with the other
      // identity-change paths (password reset, role change, etc.).
      tokenVersion:     { increment: 1 },
    },
  })

  await deleteSession()
  return NextResponse.json({ ok: true })
}
