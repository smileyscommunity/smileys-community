import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: listingId } = await params

  const existing = await prisma.savedListing.findUnique({
    where: { userId_listingId: { userId: session.id, listingId } },
  })

  if (existing) {
    await prisma.savedListing.delete({
      where: { userId_listingId: { userId: session.id, listingId } },
    })
    return NextResponse.json({ saved: false })
  } else {
    await prisma.savedListing.create({
      data: { userId: session.id, listingId },
    })
    return NextResponse.json({ saved: true })
  }
}
