import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { rateLimit, getIp } from '@/lib/rateLimit'

type Params = { params: Promise<{ id: string }> }

const ALLOWED_REASONS = new Set(['closed', 'wrong_info', 'inappropriate', 'other'])
const MESSAGE_MAX = 600

// POST /api/directory/[id]/report — anyone (logged-in or anonymous)
// can flag a problem with a directory entry. Anonymous reports keep
// the bar low for closed-shop drive-by fixes; rate limit is per-IP
// for anonymous and per-user otherwise so an anonymous spammer can't
// flood the queue without rotating IPs.
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getSession()
    const { id } = await params

    const limiterKey = session ? `directory-report:user:${session.id}` : `directory-report:ip:${getIp(req)}`
    if (!await rateLimit(limiterKey, 5, 60 * 60_000)) {
      return NextResponse.json({ error: 'Too many reports. Try again later.' }, { status: 429 })
    }

    const business = await prisma.business.findUnique({
      where:  { id },
      select: { id: true, isApproved: true, isActive: true },
    })
    // Match the gate used by every other public write endpoint
    // (reviews, save, claim). An admin-deactivated business is no
    // longer publicly visible, so accepting reports against it
    // pollutes the queue with reports the admin already actioned.
    if (!business || !business.isApproved || !business.isActive) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => null) as { reason?: unknown; message?: unknown } | null
    if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

    const reason = typeof body.reason === 'string' ? body.reason : ''
    if (!ALLOWED_REASONS.has(reason)) {
      return NextResponse.json({ error: 'Pick a reason' }, { status: 400 })
    }
    const message = typeof body.message === 'string' && body.message.trim()
      ? body.message.trim().slice(0, MESSAGE_MAX)
      : null

    await prisma.businessReport.create({
      data: {
        businessId: id,
        reporterId: session?.id ?? null,
        reason,
        message,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('Directory report POST error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
