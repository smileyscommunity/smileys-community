import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { canModerateReports, isAdmin } from '@/lib/access'

export async function GET() {
  try {
    const session = await getSession()
    if (!session || !canModerateReports(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Reports don't carry cityId directly; they're scoped via the
    // reported user's cityId. Moderators see only reports against
    // users in their own city. Admins see everything.
    const cityFilter = isAdmin(session) || !session.cityId
      ? {}
      : { reported: { is: { cityId: session.cityId } } }

    const reports = await prisma.report.findMany({
      where:   cityFilter,
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
