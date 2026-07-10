import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendNewsletterBatch, recordEmailFailure } from '@/lib/email'
import { checkCronAuth } from '@/lib/cronAuth'
import { buildWeeklyDigest } from '@/lib/newsletterDigest'

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

  const auto = await runAutoDigest()

  return NextResponse.json({ ok: true, processed: due.length, totalSent, auto })
}

// Weekly auto-newsletter: when the admin toggle (app_settings key
// 'autoWeeklyNewsletter') is on, compose the digest server-side and send it
// every Friday from 10:00 Istanbul. One issue per week — the segment marker
// 'auto-weekly' on the Newsletter row doubles as the already-sent lock, and
// the row is created (status 'sending') BEFORE the blast so a concurrent
// sweeper tick can't double-send.
async function runAutoDigest(): Promise<string> {
  const setting = await prisma.appSetting.findUnique({ where: { key: 'autoWeeklyNewsletter' } })
  if (setting?.value !== 'on') return 'off'

  const nowIst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }))
  if (nowIst.getDay() !== 5 || nowIst.getHours() < 10) return 'outside-window'

  const recentAuto = await prisma.newsletter.findFirst({
    where: { segment: 'auto-weekly', sentAt: { gte: new Date(Date.now() - 6 * 86_400_000) } },
    select: { id: true },
  })
  if (recentAuto) return 'already-sent-this-week'

  // Don't stack onto a manual blast: if ANY issue went out in the last
  // 3 days (e.g. the admin sent one Thursday, or flips the toggle on a
  // Friday afternoon right after a manual send), skip this week's auto
  // issue rather than emailing everyone twice.
  const recentManual = await prisma.newsletter.findFirst({
    where: { status: 'sent', sentAt: { gte: new Date(Date.now() - 3 * 86_400_000) } },
    select: { id: true },
  })
  if (recentManual) return 'skipped-recent-manual-issue'

  const digest = await buildWeeklyDigest()
  if (!digest) return 'skipped-no-events'

  // Attributed to the oldest admin account (the info@ house account).
  const admin = await prisma.user.findFirst({ where: { role: 'admin' }, orderBy: { joinedAt: 'asc' }, select: { id: true } })
  if (!admin) return 'no-admin-account'

  const recipients = await prisma.user.findMany({
    where:  recipientWhere('all'),
    select: { id: true, email: true, name: true },
  })
  if (recipients.length === 0) return 'no-recipients'

  const nl = await prisma.newsletter.create({
    data: {
      subject: digest.subject, bodyHtml: digest.bodyHtml,
      segment: 'auto-weekly', status: 'sending',
      recipientCount: recipients.length, sentById: admin.id,
    },
  })

  const { sent, resendLogs, failed } = await sendNewsletterBatch(recipients, digest.subject, digest.bodyHtml, nl.id)
  for (const f of failed) {
    recordEmailFailure({ helper: 'sendNewsletterEmail (auto-weekly)', recipient: f.email, error: f.error }).catch(() => {})
  }
  if (resendLogs.length > 0) {
    await prisma.newsletterEmailLog.createMany({ data: resendLogs, skipDuplicates: true })
  }
  await prisma.newsletter.update({
    where: { id: nl.id },
    data:  { status: 'sent', recipientCount: sent, sentAt: new Date() },
  })
  console.log(`[sweep-newsletters] auto-weekly issue sent to ${sent} members (${failed.length} failed)`)
  return `sent-${sent}`
}
