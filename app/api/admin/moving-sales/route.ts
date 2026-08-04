import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdminOrModerator } from '@/lib/access'

// Admin list — unlike the public GET (which only shows active,
// non-expired sales, capped at 30), this surfaces everything so staff can
// find and remove a bad post regardless of status or expiry. Removal
// itself reuses the existing owner/staff PATCH at /api/moving-sales/[id]
// (already checks isAdminOrModerator) — no new mutation endpoint needed.
export async function GET() {
  try {
    const session = await getSession()
    if (!session || !isAdminOrModerator(session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const sales = await prisma.movingSale.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, leavingOn: true, neighborhood: true, note: true, status: true, createdAt: true,
        user:  { select: { id: true, name: true, email: true, color: true } },
        items: { select: { id: true, name: true, price: true, claimed: true } },
      },
    })
    return NextResponse.json({ sales })
  } catch (e) {
    console.error('Admin moving-sales GET error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
