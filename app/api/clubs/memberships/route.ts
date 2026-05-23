import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

export async function GET() {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json([])

    const memberships = await prisma.clubMembership.findMany({
      where: { userId: session.id },
      select: { clubId: true, status: true, role: true },
    })

    return NextResponse.json(memberships)
  } catch (e) {
    console.error(e)
    return NextResponse.json([])
  }
}
