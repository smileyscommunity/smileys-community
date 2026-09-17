// Correct the standing announcement on every live city board after the tier
// rule changed on 2026-09-17: any event with limited spots is limited, at any
// size, not "20 seats or fewer". Rewrites that one sentence and nothing else on
// the posts scripts/post-standing-announcement.ts created. Guarded on the exact
// old body, so a re-run, or a post someone has since edited, is left alone.
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
const OLD_SENTENCE = "It only covers limited events: 20 seats or fewer, or a booking promised to a venue. Open events never count."
const NEW_SENTENCE = "It covers any event with limited spots, any size, or a booking promised to a venue. Uncapped events never count."

async function main() {
  console.log(APPLY ? 'APPLY — updating\n' : 'DRY RUN — nothing is written. APPLY=1 updates.\n')
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
    if (!post.body.includes(OLD_SENTENCE)) { console.log(`  ${post.city.slug}: already corrected or edited, skipped`); continue }
    const body = post.body.replace(OLD_SENTENCE, NEW_SENTENCE)
    if (body.length > 1000) throw new Error(`${post.city.slug}: corrected body is ${body.length} chars, over the board's 1000`)
    if (!APPLY) { console.log(`  ${post.city.slug}: would update (${post.body.length} → ${body.length} chars)`); continue }
    const { count } = await prisma.boardPost.updateMany({ where: { id: post.id, body: post.body }, data: { body } })
    console.log(`  ${post.city.slug}: ${count ? 'updated' : 'changed meanwhile, skipped'}`)
    updated += count
  }
  console.log(APPLY ? `\nUpdated ${updated} post${updated === 1 ? '' : 's'}.` : '\nDry run complete.')
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
