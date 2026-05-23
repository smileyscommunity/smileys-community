import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

// GET — return list of people who viewed my profile (last 30 days)
export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const views = await prisma.profileView.findMany({
    where: { viewedId: session.id, createdAt: { gte: since }, viewerId: { not: session.id } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      viewer: { select: { id: true, name: true, color: true, profilePhoto: true, neighborhood: true } },
    },
  })

  return NextResponse.json(views.map(v => ({
    id: v.id,
    viewedAt: v.createdAt,
    viewer: { id: v.viewer.id, name: v.viewer.name, color: v.viewer.color, photo: v.viewer.profilePhoto, neighborhood: v.viewer.neighborhood },
  })))
}
