import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendNewsletterEmail, recordEmailFailure } from '@/lib/email'
import { checkCronAuth } from '@/lib/cronAuth'

const BATCH_SIZE     = 50
const BATCH_DELAY_MS = 1000

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

    let sent = 0
    const resendLogs: { newsletterId: string; resendId: string }[] = []

    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const batch   = recipients.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(u => sendNewsletterEmail(u.id, u.email, u.name, nl.subject, nl.bodyHtml, nl.id))
      )
      for (let j = 0; j < results.length; j++) {
        if (results[j].status === 'fulfilled') {
          sent++
          resendLogs.push({ newsletterId: nl.id, resendId: (results[j] as PromiseFulfilledResult<string>).value })
        } else {
          recordEmailFailure({
            helper: 'sendNewsletterEmail (scheduled)',
            recipient: batch[j].email,
            error: (results[j] as PromiseRejectedResult).reason,
          }).catch(() => {})
        }
      }
      if (i + BATCH_SIZE < recipients.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
      }
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
