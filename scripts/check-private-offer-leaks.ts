// Read-only: fail if any restricted member offer (url or code) appears in a
// public place — any post's body/excerpt/cover/eventDetails, or the compiled
// partners data. Run on the server after publishing or editing an offer.
//   npx tsx --env-file=.env --env-file=.env.local scripts/check-private-offer-leaks.ts
import { prisma } from '@/lib/prisma'

async function main() {
  const offers = await prisma.postMemberOffer.findMany({ select: { url: true, code: true, post: { select: { slug: true } } } })
  const posts = await prisma.post.findMany({ select: { slug: true, title: true, body: true, excerpt: true, coverImage: true, eventDetails: true } })
  let leaks = 0
  for (const o of offers) {
    for (const secret of [o.url, o.code].filter((s): s is string => !!s)) {
      for (const p of posts) {
        const where: string[] = (['body', 'excerpt', 'coverImage'] as const).filter(k => p[k]?.includes(secret))
        if (JSON.stringify(p.eventDetails ?? '').includes(secret)) where.push('eventDetails')
        if (where.length) { leaks++; console.log(`LEAK: offer on "${o.post.slug}" appears in "${p.slug}" (${where.join(', ')})`) }
      }
    }
  }
  console.log(`${offers.length} offer(s) checked against ${posts.length} posts — ${leaks} leak(s)`)
  process.exit(leaks ? 1 : 0)
}
main().finally(() => prisma.$disconnect())
