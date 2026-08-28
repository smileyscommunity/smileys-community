// Fact-check corrections to the İzmirim Kart article (2026-08-28, checked
// against the official izmir.bel.tr pages the article cites):
//   1. Sale points were understated — seven ferry terminals sell the card,
//      not two, plus the Intercity Bus Terminal; and the municipality lists
//      exactly TWO designated 24-hour booths, not "booths around the city".
//   2. The 90-minute transfer is network-wide (city buses included) — only
//      district-bound routes are excluded. The article scoped it to
//      metro/tram/İZBAN/ferries, which would make a bus→metro reader
//      expect to pay twice.
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local scripts/correct-izmirim-kart.ts
//
// Guarded string replacement: each edit must find its exact current text or
// the script aborts untouched — so a re-run (or a hand-edited article) can
// never mangle the body. lastReviewedAt stays null: this was a remote
// source-check, not a human in İzmir.
import { prisma } from '@/lib/prisma'

const DRY_RUN = process.env.DRY_RUN === '1'
const SLUG = 'izmirim-kart-the-only-ticket-that-matters'

const EDITS: Array<{ find: string; replace: string }> = [
  {
    find:    '<p>Cards and tickets are sold at Konak and Karşıyaka ferry terminals, at the central metro stations — Konak, Fahrettin Altay, Bornova, Halkapınar and Şirinyer — at the airport stations, and at designated 24-hour booths around the city.</p>',
    replace: '<p>Cards and tickets are sold at all seven ferry terminals — Konak, Bostanlı, Karşıyaka, Alsancak, Göztepe, Üçkuyular and Pasaport — at the central metro stations — Konak, Fahrettin Altay, Bornova, Halkapınar and Şirinyer — at the airport stations, at the Intercity Bus Terminal, and at two designated 24-hour booths.</p>',
  },
  {
    find:    '<p>On the metro, tram, İZBAN and the ferries, the second and any subsequent rides within 90 minutes of your first are <strong>free</strong>. A ferry across the bay followed by a metro ride is one fare, not two — so long as you tap within the window.</p>',
    replace: '<p>The second and any subsequent rides within 90 minutes of your first are <strong>free</strong> — and the rule covers the whole network: metro, tram, İZBAN, the ferries and city buses alike. A ferry across the bay followed by a metro ride is one fare, not two — so long as you tap within the window.</p>',
  },
]

async function main() {
  const post = await prisma.post.findUnique({ where: { slug: SLUG }, select: { id: true, body: true } })
  if (!post) throw new Error(`Article not found: ${SLUG}`)

  let body = post.body
  for (const [i, e] of EDITS.entries()) {
    if (!body.includes(e.find)) throw new Error(`Edit ${i + 1}: current text not found — article already corrected or hand-edited; aborting untouched`)
    body = body.replace(e.find, e.replace)
    console.log(`✓ edit ${i + 1} matched`)
  }

  if (DRY_RUN) { console.log('DRY RUN — nothing written'); return }
  await prisma.post.update({ where: { id: post.id }, data: { body } })
  console.log(`✓ corrected ${SLUG}`)
}

main().then(() => process.exit(0)).catch(e => { console.error('✗', e instanceof Error ? e.message : e); process.exit(1) })
