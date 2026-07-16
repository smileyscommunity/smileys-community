// One-off: nudge members to review directory businesses they've actually
// visited with Smileys. For every approved directory business, find
// members who checked in at a past event held there, and send ONE in-app
// notification (their single most-attended venue — never one per venue).
// No email; a quiet in-app nudge fits the no-spam ethos.
//
// Skips members who already reviewed that business, and members who ever
// received a directory_review_nudge notification (idempotent across
// re-runs). Default mode is dry-run; re-run with --send to notify.
//
// Run on prod (notify.ts needs web-push VAPID keys from .env.local):
//   ssh root@<server> 'cd /root/smileys-community && \
//     npx tsx --env-file=.env --env-file=.env.local scripts/send-review-nudges.ts'          # dry run
//   ssh root@<server> 'cd /root/smileys-community && \
//     npx tsx --env-file=.env --env-file=.env.local scripts/send-review-nudges.ts --send'   # send
//
// If a business name and event.location drift apart, re-check the ALIAS
// map below (same convention as scripts/import-event-venues.ts).

import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notify'

const ALIAS: Record<string, string> = {
  'Buka': 'Buka Yeldeğirmeni',
  'Blak Coffee Yeldeğirmeni':  'BLAK Coffee Co. Yeldeğirmeni',
  'Blak Yeldeğirmeni':         'BLAK Coffee Co. Yeldeğirmeni',
  'Black Coffee Yeldeğirmeni': 'BLAK Coffee Co. Yeldeğirmeni',
}

const norm = (s: string) => (ALIAS[s.replace(/\s+/g, ' ').trim()] ?? s.replace(/\s+/g, ' ').trim()).toLowerCase()

async function main() {
  const send = process.argv.includes('--send')
  const today = new Date().toISOString().slice(0, 10)

  const businesses = await prisma.business.findMany({
    where: { isApproved: true, isActive: true },
    select: { id: true, name: true },
  })
  const byName = new Map(businesses.map(b => [norm(b.name), b]))

  // Checked-in attendance at past, non-cancelled events whose venue has
  // a directory listing.
  const attendance = await prisma.eventAttendee.findMany({
    where: {
      status: 'approved', checkedIn: true,
      event: { date: { lt: today }, cancelledAt: null },
    },
    select: { userId: true, event: { select: { location: true } } },
  })

  // userId → (businessId → visit count)
  const visits = new Map<string, Map<string, number>>()
  for (const a of attendance) {
    const biz = byName.get(norm(a.event.location ?? ''))
    if (!biz) continue
    if (!visits.has(a.userId)) visits.set(a.userId, new Map())
    const m = visits.get(a.userId)!
    m.set(biz.id, (m.get(biz.id) ?? 0) + 1)
  }

  const userIds = [...visits.keys()]
  if (!userIds.length) { console.log('No matching attendance — nothing to do.'); return }

  const [reviews, nudged, users] = await Promise.all([
    prisma.businessReview.findMany({
      where: { authorId: { in: userIds } },
      select: { authorId: true, businessId: true },
    }),
    prisma.notification.findMany({
      where: { type: 'directory_review_nudge', userId: { in: userIds } },
      select: { userId: true },
    }),
    prisma.user.findMany({
      where: { id: { in: userIds }, status: 'approved' },
      select: { id: true, name: true },
    }),
  ])
  const reviewed     = new Set(reviews.map(r => `${r.authorId}:${r.businessId}`))
  const alreadySent  = new Set(nudged.map(n => n.userId))
  const approvedUser = new Map(users.map(u => [u.id, u]))

  let planned = 0, sent = 0
  const bizId = new Map(businesses.map(b => [b.id, b]))

  for (const [userId, m] of visits) {
    if (alreadySent.has(userId)) continue
    const user = approvedUser.get(userId)
    if (!user) continue
    // Most-visited business this member hasn't reviewed yet.
    const candidates = [...m.entries()]
      .filter(([businessId]) => !reviewed.has(`${userId}:${businessId}`))
      .sort((a, b) => b[1] - a[1])
    if (!candidates.length) continue
    const [businessId, count] = candidates[0]
    const biz = bizId.get(businessId)!

    planned++
    console.log(`${send ? '→' : '·'} ${user.name}: ${biz.name} (${count} visit${count === 1 ? '' : 's'})`)

    if (send) {
      await createNotification(
        userId,
        'directory_review_nudge',
        `Been to ${biz.name} with us?`,
        `You've checked in at ${count} Smileys event${count === 1 ? '' : 's'} there — leave the first review and help other members find it.`,
        `/directory/${businessId}`,
      )
      sent++
    }
  }

  console.log(
    send
      ? `\n✓ Sent ${sent} notifications`
      : `\nDRY RUN — would notify ${planned} members (1 notification each). Re-run with --send.`
  )
}

main().finally(() => prisma.$disconnect())
