import { canViewAuditLog } from '@/lib/access'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session || !canViewAuditLog(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') ?? ''
  const take   = Math.min(parseInt(searchParams.get('take') ?? '100'), 200)

  const logs = await prisma.auditLog.findMany({
    where: action ? { action: { contains: action } } : undefined,
    orderBy: { createdAt: 'desc' },
    take,
  })
  return NextResponse.json(logs)
}
