// Post the standing announcement to the community board of every live city,
// as the Smileys Admin account. One Share post per city. A city whose board
// already has an active post with this title from the same author is skipped,
// so a re-run writes nothing. Board posts send no notifications.
//
// It also takes down the v1 announcement ("A small change so free events stop
// losing seats", posted 2026-09-03 to five boards), whose rules are no longer
// the ones in force: status → 'removed', guarded on id, title and 'active', so
// a re-run changes nothing and the rows can be restored by setting 'active'.
//
// The text is the board version of docs/no-show-announcement.draft.md §1,
// held to the board's own limits (title 120, body 1000, one link —
// app/api/board/route.ts), which this script checks before writing.
//
//   (default)  DRY RUN — prints what would be posted where, writes nothing
//   APPLY=1    creates the posts
//
//   npx tsx --env-file=.env --env-file=.env.local scripts/post-standing-announcement.ts
//   APPLY=1 npx tsx --env-file=.env --env-file=.env.local scripts/post-standing-announcement.ts

import { prisma } from '@/lib/prisma'

const APPLY        = process.env.APPLY === '1'
const AUTHOR_EMAIL = 'info@smileyscommunity.com'
const CITY_SLUGS   = ['istanbul', 'antalya', 'izmir', 'bodrum', 'ankara', 'bursa']

// The v1 posts, by id (read from production 2026-09-15): antalya, bodrum, bursa, istanbul, izmir.
const V1_TITLE_PREFIX = 'A small change so free events stop losing seats'
const V1_POST_IDS = [
  'cmtlg5z0c00005p6facy2you6', 'cmtlg5z0r00015p6f2cc4a1ut', 'cmtlg5z1000025p6ffqvf3x1e',
  'cmtlg2dm40000x36f6l6pboaa', 'cmtlg5z1e00035p6fj0bqm3cu',
]

const TITLE = 'Keeping seats for the people who come 🎟️'
const BODY = `From 16 September, Smileys keeps a simple record of whether you turn up for the seats you take: your standing. It covers any event with limited spots, any size, or a booking promised to a venue. Uncapped events never count.

What counts:
• Not coming. If the host checked people in and you weren't, you're absent unless they excuse you the day after.
• Cancelling less than 24h before a limited event, unless someone from the waitlist takes your seat and comes, or you're answering the "still coming?" message.

• 2 in 90 days → yellow card: back of limited waitlists. Clears after 2 events where you're checked in.
• 1 more → red card: the host approves your seat at limited events. After 3 check-ins, an admin restores your standing.
• Open events are never blocked. Cards lapse after 90 days with no RSVPs.

Missed at the door? Tap "I was there" on Your standing within 30 days; a moderator decides, not the host. It's private, new cities get a 90-day head start, and everyone starts clean.`

async function main() {
  console.log(APPLY ? 'APPLY — posting\n' : 'DRY RUN — nothing is written. APPLY=1 posts.\n')

  const links = (`${TITLE} ${BODY}`.match(/\b(?:https?:\/\/|www\.)\S+/gi) ?? []).length
  if (TITLE.length > 120 || BODY.length > 1000 || links > 1) {
    throw new Error(`Over the board's limits: title ${TITLE.length}/120, body ${BODY.length}/1000, links ${links}/1`)
  }

  const author = await prisma.user.findFirst({
    where:  { email: { equals: AUTHOR_EMAIL, mode: 'insensitive' }, status: 'approved' },
    select: { id: true, name: true, role: true },
  })
  if (!author) throw new Error(`No approved account for ${AUTHOR_EMAIL}`)
  console.log(`Author: ${author.name} (${author.role}) · title ${TITLE.length} chars · body ${BODY.length} chars\n`)

  const cities = await prisma.city.findMany({ where: { slug: { in: CITY_SLUGS } }, select: { id: true, slug: true, status: true } })
  const missing = CITY_SLUGS.filter(s => !cities.some(c => c.slug === s))
  if (missing.length > 0) throw new Error(`Cities not found: ${missing.join(', ')}`)

  let created = 0
  for (const slug of CITY_SLUGS) {
    const city = cities.find(c => c.slug === slug)!
    const existing = await prisma.boardPost.findFirst({
      where:  { cityId: city.id, userId: author.id, title: TITLE, status: 'active' },
      select: { id: true },
    })
    if (existing) { console.log(`  ${slug}: already posted (${existing.id}), skipped`); continue }
    if (!APPLY)   { console.log(`  ${slug} (${city.status}): would post`); continue }
    const post = await prisma.boardPost.create({
      data:   { userId: author.id, cityId: city.id, type: 'share', title: TITLE, body: BODY },
      select: { id: true },
    })
    console.log(`  ${slug}: posted ${post.id}`)
    created++
  }
  const v1Where = { id: { in: V1_POST_IDS }, title: { startsWith: V1_TITLE_PREFIX }, status: 'active' }
  const v1 = await prisma.boardPost.findMany({ where: v1Where, select: { id: true, city: { select: { slug: true } } } })
  console.log(`\nv1 announcement posts still active: ${v1.length} (${v1.map(p => p.city.slug).join(', ') || 'none'})`)
  let removed = 0
  if (APPLY && v1.length > 0) {
    removed = (await prisma.boardPost.updateMany({ where: v1Where, data: { status: 'removed' } })).count
    console.log(`  removed ${removed}`)
  }

  console.log(APPLY ? `\nCreated ${created} post${created === 1 ? '' : 's'}, removed ${removed} v1 post${removed === 1 ? '' : 's'}.` : '\nDry run complete.')
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
