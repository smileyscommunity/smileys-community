import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { rateLimit } from '@/lib/rateLimit'
import { writeAudit } from '@/lib/audit'
import { APP_URL } from '@/lib/env'
import { firstNameOf } from '@/lib/data'
import { issueActivationToken } from '@/lib/activation'
import { NOT_ACTIVATED_MEMBER_WHERE } from '@/lib/memberCount'
import { activationWhatsAppMessage, activationWhatsAppUrl } from '@/lib/activationWhatsApp'

// One tap on Retention > Not activated: mint a fresh activation link for a
// member who was approved but never set a password, and hand back a wa.me
// link with the message filled in. The admin sends it from their own
// WhatsApp; nothing is sent from here.
//
// Admin-only, like the list: the link carries the member's phone number,
// which moderators never see (lib/admin/maskContact).
//
// issueActivationToken replaces every earlier token, so the link in the last
// email stops working and this one is the member's only live link. The weekly
// login-nudge email that may follow adds a token without removing this one.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // Each call mints a token and writes an audit row; a stuck button should
  // not be able to churn through a member's links.
  if (!await rateLimit(`activation-whatsapp:${session.id}`, 30, 60_000)) {
    return NextResponse.json({ error: 'Too many requests — try again in a minute' }, { status: 429 })
  }

  const body = await req.json().catch(() => null) as { userId?: unknown } | null
  const userId = typeof body?.userId === 'string' ? body.userId : null
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

  const user = await prisma.user.findFirst({
    where: { id: userId, ...NOT_ACTIVATED_MEMBER_WHERE },
    select: { id: true, name: true, phone: true, nationality: true, cityId: true },
  })
  if (!user) {
    // Gone, not approved, or they activated since the list loaded.
    const exists = await prisma.user.findUnique({ where: { id: userId }, select: { password: true, status: true } })
    if (exists?.status === 'approved' && exists.password) {
      return NextResponse.json({ error: 'Already activated — no message needed' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  // Check the number before minting, so a bad number leaves the emailed link working.
  if (!activationWhatsAppUrl(user.phone, user.nationality, 'x')) {
    return NextResponse.json({ error: 'No usable WhatsApp number on file' }, { status: 422 })
  }

  const token   = await issueActivationToken(user.id)
  const message = activationWhatsAppMessage(firstNameOf(user.name), `${APP_URL}/activate?token=${token}`)
  const url     = activationWhatsAppUrl(user.phone, user.nationality, message)!

  const now = new Date()
  await prisma.user.update({ where: { id: user.id }, data: { whatsappNudgedAt: now } })
  writeAudit(session.id, session.name, 'user.activation_whatsapp', user.id, 'user',
    { name: user.name, cityId: user.cityId },
    `WhatsApp activation link sent to ${user.name ?? user.id}`)

  return NextResponse.json({ url, whatsappNudgedAt: now.toISOString() })
}
