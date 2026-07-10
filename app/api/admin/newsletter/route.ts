import { type NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { isAdmin } from '@/lib/access'
import { sendNewsletterEmail, recordEmailFailure } from '@/lib/email'
import { writeAudit } from '@/lib/audit'
import { sanitizeNewsletter } from '@/lib/sanitize'

export const dynamic = 'force-dynamic'

const BATCH_SIZE    = 50
const BATCH_DELAY_MS = 1000

type Segment = 'all' | 'new' | 'active' | 'inactive'

const BASE_WHERE = { emailMarketing: true, emailVerified: true, status: 'approved' } as const

function recipientWhere(segment: Segment) {
  const now = new Date()
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000)
  switch (segment) {
    case 'new':
      return { ...BASE_WHERE, joinedAt: { gte: days(60) } }
    case 'active':
      return { ...BASE_WHERE, joinedEvents: { some: { status: 'approved', joinedAt: { gte: days(90) } } } }
    case 'inactive':
      return { ...BASE_WHERE, joinedEvents: { none: { status: 'approved', joinedAt: { gte: days(180) } } } }
    default:
      return BASE_WHERE
  }
}

// GET /api/admin/newsletter — history + segment counts + sample recipients
export async function GET() {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const [newsletters, allCount, newCount, activeCount, inactiveCount, sampleRecipients] = await Promise.all([
    prisma.newsletter.findMany({
      orderBy: { sentAt: 'desc' },
      take: 50,
      include: { sentBy: { select: { name: true } } },
    }),
    prisma.user.count({ where: recipientWhere('all') }),
    prisma.user.count({ where: recipientWhere('new') }),
    prisma.user.count({ where: recipientWhere('active') }),
    prisma.user.count({ where: recipientWhere('inactive') }),
    prisma.user.findMany({
      where: BASE_WHERE,
      select: { name: true },
      take: 5,
      orderBy: { joinedAt: 'desc' },
    }),
  ])

  return NextResponse.json({
    newsletters: newsletters.map(n => ({
      id:               n.id,
      subject:          n.subject,
      bodyHtml:         n.bodyHtml,
      segment:          n.segment,
      status:           n.status,
      scheduledFor:     n.scheduledFor,
      recipientCount:   n.recipientCount,
      openCount:        n.openCount,
      clickCount:       n.clickCount,
      unsubscribeCount: n.unsubscribeCount,
      sentAt:           n.sentAt,
      sentBy:           n.sentBy,
    })),
    segmentCounts: { all: allCount, new: newCount, active: activeCount, inactive: inactiveCount },
    sampleRecipients: sampleRecipients.map(u => u.name.split(' ')[0]),
  })
}

// POST /api/admin/newsletter — send to opted-in members (optionally filtered by segment)
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session || !isAdmin(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body         = await req.json().catch(() => null)
  const subject      = typeof body?.subject  === 'string' ? body.subject.trim().slice(0, 200) : ''
  const bodyHtml     = typeof body?.bodyHtml === 'string' ? body.bodyHtml.trim() : ''
  const segment: Segment = ['all', 'new', 'active', 'inactive'].includes(body?.segment)
    ? body.segment : 'all'
  const scheduledFor = body?.scheduledFor ? new Date(body.scheduledFor) : null
  if (scheduledFor && isNaN(scheduledFor.getTime())) {
    return NextResponse.json({ error: 'Invalid scheduledFor date' }, { status: 400 })
  }

  if (!subject)  return NextResponse.json({ error: 'Subject is required' }, { status: 400 })
  if (!bodyHtml) return NextResponse.json({ error: 'Body is required' },    { status: 400 })
  if (bodyHtml.length > 100_000) return NextResponse.json({ error: 'Body too long (max 100 KB)' }, { status: 400 })

  const safeBodyHtml = sanitizeNewsletter(bodyHtml)

  // Test send — deliver a single copy to the current admin so they can preview
  // the real email (with the greeting + unsubscribe wrapper) before blasting a
  // segment. No Newsletter row, no audit, no fan-out.
  if (body?.test === true) {
    const me = await prisma.user.findUnique({ where: { id: session.id }, select: { email: true, name: true } })
    if (!me?.email) return NextResponse.json({ error: 'No email on your account to send a test to' }, { status: 400 })
    try {
      await sendNewsletterEmail(session.id, me.email, me.name, `[TEST] ${subject}`, safeBodyHtml, 'test')
      return NextResponse.json({ ok: true, test: true, email: me.email })
    } catch {
      return NextResponse.json({ error: 'Test send failed' }, { status: 500 })
    }
  }

  // For scheduled sends, persist and return early — the sweeper will fire it
  if (scheduledFor && scheduledFor > new Date()) {
    const newsletter = await prisma.newsletter.create({
      data: { subject, bodyHtml: safeBodyHtml, segment, recipientCount: 0, sentById: session.id, status: 'scheduled', scheduledFor },
    })
    return NextResponse.json({ ok: true, scheduled: true, newsletterId: newsletter.id, scheduledFor })
  }

  const recipients = await prisma.user.findMany({
    where:  recipientWhere(segment),
    select: { id: true, email: true, name: true },
  })

  const newsletter = await prisma.newsletter.create({
    data: { subject, bodyHtml: safeBodyHtml, segment, recipientCount: recipients.length, sentById: session.id },
  })

  await writeAudit(
    session.id, session.name, 'newsletter.send', newsletter.id, 'newsletter',
    { recipientCount: recipients.length, segment },
    `Sent newsletter "${subject}" to ${recipients.length} members (segment: ${segment})`,
  )

  let sent = 0
  const resendLogs: { newsletterId: string; resendId: string }[] = []

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch   = recipients.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(u => sendNewsletterEmail(u.id, u.email, u.name, subject, safeBodyHtml, newsletter.id))
    )
    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'fulfilled') {
        sent++
        resendLogs.push({ newsletterId: newsletter.id, resendId: (results[j] as PromiseFulfilledResult<string>).value })
      } else {
        recordEmailFailure({
          helper: 'sendNewsletterEmail',
          recipient: batch[j].email,
          error: (results[j] as PromiseRejectedResult).reason,
        }).catch(() => {})
      }
    }
    if (i + BATCH_SIZE < recipients.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
    }
  }

  if (resendLogs.length > 0) {
    await prisma.newsletterEmailLog.createMany({ data: resendLogs, skipDuplicates: true })
  }

  return NextResponse.json({ ok: true, sent, failed: recipients.length - sent, newsletterId: newsletter.id })
}
