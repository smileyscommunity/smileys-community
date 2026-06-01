import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const filePath = join(process.cwd(), 'data', 'member-spotlight.json')

function read() {
  try { return JSON.parse(readFileSync(filePath, 'utf-8')) } catch { return { userId: null, funFact: '', topSpots: ['', '', ''] } }
}

export async function GET() {
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
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  writeFileSync(filePath, JSON.stringify({ userId, funFact: funFact ?? '', topSpots: topSpots ?? ['', '', ''], updatedAt: new Date().toISOString() }, null, 2))
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
  writeFileSync(filePath, JSON.stringify({ userId: null, funFact: '', topSpots: ['', '', ''], updatedAt: new Date().toISOString() }, null, 2))
  return NextResponse.json({ ok: true })
}
