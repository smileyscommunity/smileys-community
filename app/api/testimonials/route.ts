import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const items = await prisma.testimonial.findMany({
    where:   { active: true },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
  })
  return NextResponse.json(items)
}
