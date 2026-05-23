import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only return data for the requesting user's own email
  const email = req.nextUrl.searchParams.get('email')?.toLowerCase().trim()
  if (!email || email !== session.email.toLowerCase()) return NextResponse.json(null)

  const app = await prisma.memberApplication.findFirst({
    where: { email, status: 'approved' },
    select: { fullName: true, country: true, interests: true },
  })

  return NextResponse.json(app)
}
