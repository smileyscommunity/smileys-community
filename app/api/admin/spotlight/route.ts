import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin, isAdminOrModerator } from '@/lib/access'
import { writeAudit } from '@/lib/audit'
import { readFileSync, writeFileSync, renameSync } from 'fs'
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
  const row = await prisma.user.findUnique({
    where:  { id: data.userId },
    select: { id: true, name: true, color: true, profilePhoto: true, neighborhood: true, bio: true,
              status: true, hiddenFromMembers: true, city: { select: { name: true } } },
  })
  if (!row) return NextResponse.json(null)
  const { status, hiddenFromMembers, ...user } = row
  // The pick is a file, so it outlives whatever happens to the member after:
  // a suspension or an admin hide left them featured. Only an approved,
  // visible member is a spotlight. Staff still get the row, flagged, so the
  // panel can say why nothing shows instead of looking unset.
  const available = status === 'approved' && !hiddenFromMembers
  if (!available && !isAdminOrModerator(session)) return NextResponse.json(null)
  return NextResponse.json({
    user, funFact: data.funFact, topSpots: data.topSpots, updatedAt: data.updatedAt,
    ...(available ? {} : { unavailable: true }),
  })
}

// There is one spotlight and it renders on every city's dashboard, so both
// writes are admin-only. Scoping by the featured member's city wasn't enough:
// a moderator featuring their own member still replaced every other city's.
function writeSpotlight(data: unknown) {
  // Atomic — write to .tmp then rename, so a concurrent GET never parses a
  // half-written file.
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2))
  renameSync(tmp, filePath)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { userId, funFact, topSpots } = await req.json()
  if (!userId || typeof userId !== 'string') return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const member = await prisma.user.findUnique({ where: { id: userId }, select: { cityId: true, status: true, hiddenFromMembers: true } })
  if (!member || member.status !== 'approved') return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  // Same rule the GET applies: a member hidden from the directory can't be
  // the one member every dashboard features.
  if (member.hiddenFromMembers) return NextResponse.json({ error: "This member is hidden from members and can't be spotlighted" }, { status: 400 })
  const fact  = typeof funFact === 'string' ? funFact.slice(0, 300) : ''
  const spots = Array.isArray(topSpots) ? topSpots.slice(0, 3).map(s => typeof s === 'string' ? s.slice(0, 120) : '') : ['', '', '']
  while (spots.length < 3) spots.push('')
  // Atomic like the announcement write, and audited like the clear.
  writeSpotlight({ userId, funFact: fact, topSpots: spots, updatedAt: new Date().toISOString() })
  writeAudit(session.id, session.name, 'spotlight.set', userId, 'spotlight', { funFact: fact, topSpots: spots }, `Spotlighted member ${userId}`)
  return NextResponse.json({ ok: true })
}

// DELETE — clear the current spotlight. Writes a minimal
// shape with userId=null so the GET handler treats it as
// "no spotlight set" and the dashboard renders its fallback.
export async function DELETE() {
  const session = await getSession()
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const previous = read()
  // Same tmp-then-rename as POST — a direct write here could leave a
  // truncated file that read() then treats as "no spotlight".
  writeSpotlight({ userId: null, funFact: '', topSpots: ['', '', ''], updatedAt: new Date().toISOString() })
  writeAudit(session.id, session.name, 'spotlight.clear', previous?.userId ?? null, 'spotlight',
    { previousUserId: previous?.userId, funFact: previous?.funFact?.slice(0, 200), topSpots: previous?.topSpots },
    `Cleared member spotlight${previous?.userId ? ` (was: user ${previous.userId})` : ''}`,
  )
  return NextResponse.json({ ok: true })
}
