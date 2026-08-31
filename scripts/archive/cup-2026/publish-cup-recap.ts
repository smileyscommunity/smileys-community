// One-off: publish the Smileys Cup 2026 results recap as a Community post.
// Created directly via Prisma (NOT the admin API) so notifyNewArticle never
// fires — a deliberate "gentle" publish with no member push. notifiedAt is
// pre-set so a future admin edit can't trigger the broadcast either.
//   npx tsx --env-file=.env --env-file=.env.local scripts/publish-cup-recap.ts
import { prisma } from '../../../lib/prisma'

const body = `
<p>What a tournament. The Smileys Cup 2026 is officially in the books — here's how it all finished.</p>
<h2>🏆 Your world champions: Spain</h2>
<p>Spain lifted the trophy with a 1–0 win over Argentina in the final, after seeing off France 2–0 in the semis. Argentina reached the final by edging England 2–1 in a thriller.</p>
<h2>🥇 The Smileys Cup crown: Semih A.</h2>
<p>Across every match prediction and bracket pick, <strong>Semih A.</strong> finished clear at the top with <strong>402 points</strong> (227 from predictions + 175 from the bracket). Congratulations! 👏</p>
<h3>The podium</h3>
<ul>
<li>🥇 <strong>Semih A.</strong> — 402</li>
<li>🥈 <strong>Berk T.</strong> — 299</li>
<li>🥉 <strong>Ryan L.</strong> — 259</li>
</ul>
<h3>Top ten predictors</h3>
<ol>
<li>Semih A. — 402</li>
<li>Berk T. — 299</li>
<li>Ryan L. — 259</li>
<li>Amirsam G. — 239</li>
<li>Ahmed H. — 232</li>
<li>Tahir T. — 193</li>
<li>Arslan S. — 175</li>
<li>Bilal M. — 175</li>
<li>Guner N. — 175</li>
<li>Ahmed E. — 175</li>
</ol>
<h2>Thank you for playing</h2>
<p>The picks, the group-chat trash talk, the last-minute predictions — that's the community we love. Until the next tournament ⚽</p>
`.trim()

async function main() {
  const slug = 'smileys-cup-2026-how-it-finished'
  const existing = await prisma.post.findUnique({ where: { slug } })
  if (existing) { console.log('Already exists:', existing.id, '/posts/' + slug); return }

  const post = await prisma.post.create({
    data: {
      title:       'Smileys Cup 2026: How it finished 🏆',
      slug,
      excerpt:     'Spain lifted the trophy — and Semih A. took the Smileys crown. The final podium, the top-ten predictors, and a thank-you to everyone who played.',
      body,
      coverImage:  null,
      status:      'published',
      kind:        'community',
      category:    'Community',
      authorId:    'cmoofepme0000bj6fkazj835e',
      publishedAt: new Date(),
      notifiedAt:  new Date(),   // suppress the new-article broadcast — deliberate gentle publish
      views:       0,
    },
  })
  console.log('Created:', post.id, '→ /posts/' + post.slug)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
