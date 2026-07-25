// STATUS: already run on 2026-07-25 (announced the 5 pre-feature handbook
// articles to the membership). Now idempotent — notifyNewArticle claims
// Post.notifiedAt, which is set on every published article, so re-running this
// is a no-op. To deliberately re-announce, clear notifiedAt on the target rows
// first. Kept as provenance per the scripts/ one-off convention.
//
// One-off backfill: send the "new article" notification for every already-
// published article that predates the notify-on-publish feature. Reuses
// notifyNewArticle so per-member preference gating (newEvents) and quiet
// hours still apply — members who muted new-event pings won't be touched.
//
// Oldest-first so the newest article ends up on top of each member's feed.
// Run on the server (needs localhost DB + VAPID keys from .env.local):
//   npx tsx --env-file=.env --env-file=.env.local scripts/backfill-article-notifications.ts
import { prisma } from '../lib/prisma'
import { notifyNewArticle } from '../lib/notify'

async function main() {
  const posts = await prisma.post.findMany({
    where:   { status: 'published', kind: { in: ['handbook', 'community'] } },
    orderBy: { publishedAt: 'asc' },
    select:  { id: true, title: true, slug: true, kind: true, authorId: true },
  })

  const audience = await prisma.user.count({ where: { status: 'approved' } })
  console.log(`Articles to backfill: ${posts.length} · approved audience: ${audience}\n`)

  for (const p of posts) {
    const before = await prisma.notification.count({ where: { type: 'new_article' } })
    await notifyNewArticle(p)
    const after = await prisma.notification.count({ where: { type: 'new_article' } })
    console.log(`✓ ${p.title}  (+${after - before} in-app notifications)`)
  }

  const total = await prisma.notification.count({ where: { type: 'new_article' } })
  console.log(`\nDone. Total new_article notifications now in DB: ${total}`)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
