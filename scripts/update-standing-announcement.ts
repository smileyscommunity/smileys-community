// Bring the standing announcement on every live city board up to the rules
// in force, on the posts scripts/post-standing-announcement.ts created:
//
//   2026-09-17  any event with limited spots is limited, at any size (not
//               "20 seats or fewer")
//   2026-09-17  not checked in where the host ran check-in = absent, unless
//               the host excuses you the day after (not "if nobody marks
//               you, you came")
//
// Replaces the whole body, and only a body that is exactly one of the known
// earlier versions, so a re-run, or a post someone has since edited, is left
// alone.
//
//   (default)  DRY RUN — prints which posts would change, writes nothing
//   APPLY=1    updates them
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/update-standing-announcement.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/update-standing-announcement.ts

import { prisma } from '@/lib/prisma'

const APPLY        = process.env.APPLY === '1'
const AUTHOR_EMAIL = 'info@smileyscommunity.com'
const TITLE        = 'Keeping seats for the people who come 🎟️'

// As posted on 2026-09-15.
const POSTED = `From 16 September, Smileys keeps a simple record of whether you turn up for the seats you take: your standing. It only covers limited events: 20 seats or fewer, or a booking promised to a venue. Open events never count.

What counts:
• Not coming, but only when the host marks you absent. If nobody marks you, you came.
• Cancelling less than 24h before a limited event, unless someone from the waitlist takes your seat and comes, or you're answering the "still coming?" message.

• 2 in 90 days → yellow card: back of limited waitlists. It clears after 2 events where you're checked in (any event).
• 1 more → red card: the host approves your seat at limited events. After 3 check-ins, an admin restores your standing.
• Open events are never blocked. Cards lapse after 90 days with no RSVPs.

Marked absent by mistake? Tap "I was there" on Your standing within 30 days; a moderator decides, never that event's host. It's private, new cities get a 90-day head start, and everyone starts clean.`
// With only the tier sentence corrected.
const TIER_CORRECTED = POSTED.replace(
  'It only covers limited events: 20 seats or fewer, or a booking promised to a venue. Open events never count.',
  'It covers any event with limited spots, any size, or a booking promised to a venue. Uncapped events never count.',
)
const PREVIOUS = [POSTED, TIER_CORRECTED]

// Keep in step with BODY in scripts/post-standing-announcement.ts.
const BODY = `From 16 September, Smileys keeps a simple record of whether you turn up for the seats you take: your standing. It covers any event with limited spots, any size, or a booking promised to a venue. Uncapped events never count.

What counts:
• Not coming. If the host checked people in and you weren't, you're absent unless they excuse you the day after.
• Cancelling less than 24h before a limited event, unless someone from the waitlist takes your seat and comes, or you're answering the "still coming?" message.

• 2 in 90 days → yellow card: back of limited waitlists. Clears after 2 events where you're checked in.
• 1 more → red card: the host approves your seat at limited events. After 3 check-ins, an admin restores your standing.
• Open events are never blocked. Cards lapse after 90 days with no RSVPs.

Missed at the door? Tap "I was there" on Your standing within 30 days; a moderator decides, not the host. It's private, new cities get a 90-day head start, and everyone starts clean.`

async function main() {
  console.log(APPLY ? 'APPLY — updating\n' : 'DRY RUN — nothing is written. APPLY=1 updates.\n')
  if (BODY.length > 1000) throw new Error(`Body is ${BODY.length} chars, over the board's 1000`)
  const author = await prisma.user.findFirst({
    where:  { email: { equals: AUTHOR_EMAIL, mode: 'insensitive' }, status: 'approved' },
    select: { id: true, name: true },
  })
  if (!author) throw new Error(`No approved account for ${AUTHOR_EMAIL}`)

  const posts = await prisma.boardPost.findMany({
    where:   { userId: author.id, title: TITLE, status: 'active' },
    select:  { id: true, body: true, city: { select: { slug: true } } },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`Found ${posts.length} active announcement post${posts.length === 1 ? '' : 's'} by ${author.name}\n`)

  let updated = 0
  for (const post of posts) {
    if (post.body === BODY) { console.log(`  ${post.city.slug}: already current, skipped`); continue }
    if (!PREVIOUS.includes(post.body)) { console.log(`  ${post.city.slug}: edited by someone, skipped`); continue }
    if (!APPLY) { console.log(`  ${post.city.slug}: would update (${post.body.length} → ${BODY.length} chars)`); continue }
    const { count } = await prisma.boardPost.updateMany({ where: { id: post.id, body: post.body }, data: { body: BODY } })
    console.log(`  ${post.city.slug}: ${count ? 'updated' : 'changed meanwhile, skipped'}`)
    updated += count
  }
  console.log(APPLY ? `\nUpdated ${updated} post${updated === 1 ? '' : 's'}.` : '\nDry run complete.')
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
