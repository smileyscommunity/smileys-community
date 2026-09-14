import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManageTags } from '@/lib/access'
import { deleteCached } from '@/lib/analyticsCache'

export async function GET() {
  const session = await getSession()
  if (!session || !canManageTags(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const groups = await prisma.tagGroup.findMany({
    orderBy: { sortOrder: 'asc' },
    include: { tags: { orderBy: { name: 'asc' } } },
  })
  return NextResponse.json(groups)
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canManageTags(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, emoji } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const group = await prisma.tagGroup.create({ data: { name: name.trim(), emoji: emoji || '🏷️' } })
  // Same 2-minute /api/tags cache the tag routes bust — a new group was invisible to pickers until it expired.
  deleteCached('tags:groups')
  return NextResponse.json(group)
}
