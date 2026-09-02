import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator, canActInCity } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const filePath = join(process.cwd(), 'data', 'member-spotlight.json')

function read() {
  try { return JSON.parse(readFileSync(filePath, 'utf-8')) } catch { return { userId: null, funFact: '', topSpots: ['', '', ''] } }
}

export async function GET() {
  // Member data (name/photo/neighborhood/bio) — require login, matching the
  // rest of the directory. Was previously an open, unauthenticated read.
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const data = read()
  if (!data.userId) return NextResponse.json(null)
  const user = await prisma.user.findUnique({
    where:  { id: data.userId },
    select: { id: true, name: true, color: true, profilePhoto: true, neighborhood: true, bio: true },
  })
  if (!user) return NextResponse.json(null)
  return NextResponse.json({ user, funFact: data.funFact, topSpots: data.topSpots, updatedAt: data.updatedAt })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { userId, funFact, topSpots } = await req.json()
  if (!userId || typeof userId !== 'string') return NextResponse.json({ error: 'userId required' }, { status: 400 })
  // The spotlight renders on every city's dashboard, and the member being
  // featured has a home city: a moderator features their own city's members.
  const member = await prisma.user.findUnique({ where: { id: userId }, select: { cityId: true, status: true } })
  if (!member || member.status !== 'approved') return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!canActInCity(session, member.cityId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const fact  = typeof funFact === 'string' ? funFact.slice(0, 300) : ''
  const spots = Array.isArray(topSpots) ? topSpots.slice(0, 3).map(s => typeof s === 'string' ? s.slice(0, 120) : '') : ['', '', '']
  while (spots.length < 3) spots.push('')
  writeFileSync(filePath, JSON.stringify({ userId, funFact: fact, topSpots: spots, updatedAt: new Date().toISOString() }, null, 2))
  return NextResponse.json({ ok: true })
}

// DELETE — clear the current spotlight. Writes a minimal
// shape with userId=null so the GET handler treats it as
// "no spotlight set" and the dashboard renders its fallback.
export async function DELETE() {
  const session = await getSession()
  if (!session || !isAdminOrModerator(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const previous = read()
  writeFileSync(filePath, JSON.stringify({ userId: null, funFact: '', topSpots: ['', '', ''], updatedAt: new Date().toISOString() }, null, 2))
  writeAudit(session.id, session.name, 'spotlight.clear', previous?.userId ?? null, 'spotlight',
    { previousUserId: previous?.userId, funFact: previous?.funFact?.slice(0, 200), topSpots: previous?.topSpots },
    `Cleared member spotlight${previous?.userId ? ` (was: user ${previous.userId})` : ''}`,
  )
  return NextResponse.json({ ok: true })
}
