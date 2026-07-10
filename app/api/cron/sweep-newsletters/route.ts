import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendNewsletterBatch, recordEmailFailure } from '@/lib/email'
import { checkCronAuth } from '@/lib/cronAuth'

type Segment = 'all' | 'new' | 'active' | 'inactive'

const BASE_WHERE = { emailMarketing: true, emailVerified: true, status: 'approved' } as const

function recipientWhere(segment: Segment) {
  const now  = new Date()
  const days = (n: number) => new Date(now.getTime() - n * 86_400_000)
  switch (segment) {
    case 'new':      return { ...BASE_WHERE, joinedAt:    { gte: days(60) } }
    case 'active':   return { ...BASE_WHERE, joinedEvents: { some: { status: 'approved', joinedAt: { gte: days(90)  } } } }
    case 'inactive': return { ...BASE_WHERE, joinedEvents: { none: { status: 'approved', joinedAt: { gte: days(180) } } } }
    default:         return BASE_WHERE
  }
}

export async function POST(req: NextRequest) {
  const denied = checkCronAuth(req)
  if (denied) return denied

  // Find newsletters scheduled for now or earlier that haven't been sent yet
  const due = await prisma.newsletter.findMany({
    where: { status: 'scheduled', scheduledFor: { lte: new Date() } },
    include: { sentBy: { select: { id: true, name: true } } },
  })

  if (due.length === 0) return NextResponse.json({ ok: true, processed: 0 })

  let totalSent = 0

  for (const nl of due) {
    // Mark as sending so concurrent sweeper runs don't double-send
    await prisma.newsletter.update({ where: { id: nl.id }, data: { status: 'sending' } })

    const recipients = await prisma.user.findMany({
      where:  recipientWhere(nl.segment as Segment),
      select: { id: true, email: true, name: true },
    })

    const { sent, resendLogs, failed } = await sendNewsletterBatch(recipients, nl.subject, nl.bodyHtml, nl.id)

    for (const f of failed) {
      recordEmailFailure({ helper: 'sendNewsletterEmail (scheduled)', recipient: f.email, error: f.error }).catch(() => {})
    }

    await prisma.newsletter.update({
      where: { id: nl.id },
      data:  { status: 'sent', recipientCount: sent, sentAt: new Date() },
    })

    if (resendLogs.length > 0) {
      await prisma.newsletterEmailLog.createMany({ data: resendLogs, skipDuplicates: true })
    }

    totalSent += sent
  }

  return NextResponse.json({ ok: true, processed: due.length, totalSent })
}
