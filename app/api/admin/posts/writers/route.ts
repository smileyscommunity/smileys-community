import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { WRITER_ROLES } from '@/lib/postWriter'

// The article editor's writer picker: every staff member an article can be
// credited to. Admins only — a moderator writes as themselves, and the form
// hides the picker when this answers 403.
export async function GET() {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const writers = await prisma.user.findMany({
    where:   { role: { in: [...WRITER_ROLES] }, status: 'approved' },
    select:  { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(writers)
}
