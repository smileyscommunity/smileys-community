import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canManageTags } from '@/lib/access'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !canManageTags(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, emoji, groupId } = await req.json()
  if (!name?.trim() || !groupId) return NextResponse.json({ error: 'Name and groupId required' }, { status: 400 })

  const tag = await prisma.tag.create({ data: { name: name.trim(), emoji: emoji || '🏷️', groupId } })
  return NextResponse.json(tag)
}
