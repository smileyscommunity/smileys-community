import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManageTags } from '@/lib/access'

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
  return NextResponse.json(group)
}
