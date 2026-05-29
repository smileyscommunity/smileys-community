import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canModerateReports } from '@/lib/access'

export async function GET() {
  try {
    const session = await getSession()
    if (!session || !canModerateReports(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const reports = await prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        reporter: { select: { id: true, name: true, email: true, color: true } },
        reported: { select: { id: true, name: true, email: true, color: true, status: true, role: true } },
      },
    })

    return NextResponse.json(reports)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
