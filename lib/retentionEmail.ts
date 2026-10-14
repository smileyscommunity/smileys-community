// The two re-engagement emails sent from admin Retention, a batch at a time:
// "never attended" (joined, set up their account, never been to an event) and
// "dormant" (went to an event, but not for 60+ days). Same shape as the
// last-call activation email (lib/activationLastCall): the page's count and
// the send route read the one queue here, so the number an admin sees is
// exactly who a press reaches.
//
// Once per member per kind, ever. A send is recorded as an audit row
// (action = RETENTION_EMAIL[kind].action, targetId = the member) and the queue
// skips anyone who has one. No column, so no migration. scripts/email-never-attended.ts
// writes the same row, so the script and the button never double-send.
//
// Audience: activated, email-verified, opted in to newsletters (the email
// carries the newsletter unsubscribe link), approved, not an admin/partner.

import { prisma } from '@/lib/prisma'
import { recipientWhere } from '@/lib/newsletterSegments'
import { dayInTz, DEFAULT_TZ } from '@/lib/cityTime'

export type RetentionEmailKind = 'never_attended' | 'dormant'

// Emails per press. Sent one at a time (Resend allows ~2 a second), so a batch
// finishes well inside the proxy timeout; the page shows what is left.
export const RETENTION_EMAIL_BATCH = 30

// Same cut-offs the Retention lists use.
const NEVER_ATTENDED_GRACE_DAYS = 7
const DORMANT_AFTER_DAYS = 60

export const RETENTION_EMAIL: Record<RetentionEmailKind, { action: string; subject: string; message: string }> = {
  never_attended: {
    action:  'retention.never_attended_email',
    subject: 'Ready for your first Smileys event?',
    message: [
      `You joined Smileys Community but haven't been to an event yet. That's completely fine, and a lot of people are in the same spot.`,
      `Pick anything that sounds fun, from a language exchange to a coffee meetup, and RSVP in a couple of taps. Events are the best way to meet people here.`,
      `Take a look at what's coming up and choose one that suits you.`,
    ].join('\n\n'),
  },
  dormant: {
    action:  'retention.dormant_email',
    subject: `It's been a while. See what's on at Smileys`,
    message: [
      `It's been a while since your last Smileys event, and we'd love to see you at another one.`,
      `New events are added regularly, from language exchanges to coffee meetups and club get-togethers. There may be something you'd enjoy.`,
      `Take a look at what's coming up and pick one.`,
    ].join('\n\n'),
  },
}

export function isRetentionEmailKind(v: unknown): v is RetentionEmailKind {
  return v === 'never_attended' || v === 'dormant'
}

type Recipient = { id: string; name: string | null; email: string }

async function alreadyEmailed(kind: RetentionEmailKind): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    where:  { action: RETENTION_EMAIL[kind].action, targetType: 'user' },
    select: { targetId: true },
  })
  return rows.map(r => r.targetId).filter((x): x is string => !!x)
}

/** Members still to email for `kind`, best first. `take` omitted = all. */
export async function retentionQueue(kind: RetentionEmailKind, now: Date = new Date(), take?: number): Promise<Recipient[]> {
  const action = RETENTION_EMAIL[kind].action

  if (kind === 'never_attended') {
    const done = await alreadyEmailed(kind)
    return prisma.user.findMany({
      where: {
        // The newsletter's "never attended · 60d+" audience, widened to every
        // member past the one-week grace (the page lists the same cohort).
        ...recipientWhere('never_attended_old', undefined, now),
        joinedAt: { lt: new Date(now.getTime() - NEVER_ATTENDED_GRACE_DAYS * 86_400_000) },
        ...(done.length ? { id: { notIn: done } } : {}),
      },
      select:  { id: true, name: true, email: true },
      orderBy: { joinedAt: 'desc' },   // most recent joiners first: the warmest
      ...(take ? { take } : {}),
    })
  }

  const cutoff = dayInTz(new Date(now.getTime() - DORMANT_AFTER_DAYS * 86_400_000), DEFAULT_TZ)
  return prisma.$queryRaw<Recipient[]>`
    SELECT u.id, u.name, u.email
    FROM users u
    JOIN event_attendees ea ON ea."userId" = u.id AND ea.status = 'approved'
    JOIN events e ON e.id = ea."eventId"
    WHERE u.status = 'approved' AND u.password IS NOT NULL AND u.role NOT IN ('admin', 'partner')
      AND u."emailMarketing" = true AND u."emailVerified" = true
      AND NOT EXISTS (
        SELECT 1 FROM audit_logs a
        WHERE a.action = ${action} AND a."targetType" = 'user' AND a."targetId" = u.id
      )
    GROUP BY u.id, u.name, u.email
    HAVING MAX(e.date) < ${cutoff}
    ORDER BY MAX(e.date) DESC       -- lapsed most recently first: likeliest to come back
    LIMIT ${take ?? null}::int
  `
}

export async function retentionRemaining(kind: RetentionEmailKind, now: Date = new Date()): Promise<number> {
  return (await retentionQueue(kind, now)).length
}
