// Publish the Antalyakart handbook article — Antalya's first city-local entry.
// Content: docs/antalyakart-publish-ready.md in the handbook's HTML format.
// Facts from the official antalyakart.com.tr pages (2026-08-31); nostalgic-tram
// suspension stated in-body; fares deliberately absent.
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local scripts/publish-antalyakart.ts
//
// Idempotent (skips if the slug exists); notifiedAt set at insert so no
// broadcast fires; lastReviewedAt stays null until a human in Antalya checks.
import { prisma } from '@/lib/prisma'

const DRY_RUN = process.env.DRY_RUN === '1'
const SLUG = 'antalyakart-one-card-for-the-bus-and-the-tram'

const BODY = `<h2>One card, the whole municipal network</h2>
<p>The Antalyakart is Antalya's contactless transport card. A single card works on the municipal buses, the AntRay tram that runs the length of the city, and the rest of the municipality's vehicles. Tap the validator as you board. (The nostalgic seafront tram is suspended after a June 2026 fire — the line is staying, the municipality says, but don't plan around it for now.)</p>
<h2>Where to get one</h2>
<p>Cards are sold at the card centres, at the top-up machines that also sell cards, and at many kiosks and corner shops around the city. The card centres keep office hours — weekdays 08:30–12:30 and 13:00–18:00, Saturdays 08:30–12:00 — but the machines don't sleep.</p>
<h2>Topping up</h2>
<p>Machines take cash or a credit card. You can also load online — through the Antalyakart app or the website — with one catch worth knowing: <strong>an online top-up reaches your card at your first boarding tap</strong>, not instantly. If you load online on the way to the stop, the balance arrives when you tap the validator, so it works — but the tap is what completes it.</p>
<h2>Transfers are the part people miss</h2>
<p>Within the transfer window — up to an hour after your first boarding, with a five-minute protection gap so the system knows it's a genuine transfer — your next boarding is free or close to it under the current tariff. Between tram lines the window stretches longer.</p>
<p>The exception matters: <strong>transfers don't apply to disposable cards or to boardings paid by bank card.</strong> If you're staying, get the actual Antalyakart — it's the transfers that make it pay.</p>
<h2>No card yet? Your bank card boards the bus</h2>
<p>Contactless credit and debit cards work on the validators for a full-fare ride. It's the day-one answer before you've found a card centre — just know you're paying full fare every time, with no transfer rights.</p>
<h2>The phone-as-card trick — Android only</h2>
<p>The Antalyakart app can turn an NFC Android phone into your card for a small one-time fee. iPhones can't do this — Apple restricts NFC — so iOS users stick with the physical card and use the app for top-ups and balance checks.</p>
<h2>What a ride costs</h2>
<p>Fares change too often for a number written here to stay true — check the current tariff on the official Antalyakart pages linked below before you load the card.</p>
<h2>Card types</h2>
<p>Alongside the standard card there's a personalised card (bring ID and a passport photo to a card centre — it protects your balance if the card is lost) and discounted cards for students, seniors and teachers. If you're a foreign resident, bring your residence permit and ask at a card centre — the document list is theirs to confirm.</p>`

async function main() {
  const existing = await prisma.post.findUnique({ where: { slug: SLUG }, select: { id: true, status: true } })
  if (existing) { console.log(`✓ already exists (${existing.status}) — nothing to do`); return }

  // Display names are member-editable; the role constraint stops byline spoofing.
  const author = await prisma.user.findFirst({ where: { name: 'Nate G.', role: { in: ['admin', 'moderator'] } }, select: { id: true, name: true } })
  if (!author) throw new Error('Author "Nate G." not found')
  const city = await prisma.city.findUnique({ where: { slug: 'antalya' }, select: { id: true, name: true } })
  if (!city) throw new Error('City not found: antalya')

  console.log(`→ publish "Antalyakart: One Card for the Bus and the Tram" as ${author.name}, city ${city.name}`)
  if (DRY_RUN) { console.log('  DRY RUN — nothing written'); return }

  const now = new Date()
  const post = await prisma.post.create({
    data: {
      title:       'Antalyakart: One Card for the Bus and the Tram',
      slug:        SLUG,
      excerpt:     "One card covers Antalya's municipal buses and the AntRay tram — with free transfers inside the window that most newcomers never realise they're entitled to, and a phone-as-card trick that only works on Android.",
      body:        BODY,
      status:      'published',
      category:    'Getting Around',
      kind:        'handbook',
      authorId:    author.id,
      cityId:      city.id,
      publishedAt: now,
      notifiedAt:  now,
      tags:        ['antalyakart', 'antray', 'tramvay', 'otobüs', 'ulaşım', 'toplu taşıma'],
      officialSources: [
        { label: 'Antalyakart — official site', url: 'https://www.antalyakart.com.tr/' },
        { label: 'Antalyakart — how-to', url: 'https://www.antalyakart.com.tr/Page/NasilYapilir' },
        { label: 'Antalyakart — FAQ', url: 'https://www.antalyakart.com.tr/Page/Faqs' },
      ],
    },
  })
  console.log(`✓ published ${post.slug} (${post.id})`)
}

main().then(() => process.exit(0)).catch(e => { console.error('✗', e instanceof Error ? e.message : e); process.exit(1) })
