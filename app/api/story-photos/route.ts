import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const items = await prisma.storyPhoto.findMany({
    where:   { active: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    take: 50,
  })
  return NextResponse.json(items)
}
