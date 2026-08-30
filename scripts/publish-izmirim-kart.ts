// Publish the İzmirim Kart handbook article — İzmir's first city-local entry.
//
// Content is docs/izmirim-kart-publish-ready.md converted to the handbook's
// HTML body format, with the worksheet's two ⚠ VERIFY blocks resolved the way
// the draft instructs (fares omitted, unverifiable eligibility detail cut).
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local scripts/publish-izmirim-kart.ts
//
// Idempotent: skips if the slug already exists. notifiedAt is set at insert so
// the "new article" broadcast never claims it — İzmir has no members yet and
// Istanbul's shouldn't be pinged about another city's transport card.
// lastReviewedAt stays null on purpose: it renders "not yet reviewed", which
// is honest until someone in İzmir checks the facts.
import { prisma } from '@/lib/prisma'

const DRY_RUN = process.env.DRY_RUN === '1'
const SLUG = 'izmirim-kart-the-only-ticket-that-matters'

const BODY = `<h2>One card, the whole city</h2>
<p>The İzmirim Kart is İzmir's contactless transport card. A single card works across the metro, the tram, İZBAN (the commuter rail that runs the length of the bay), the ferries, ESHOT city buses and the Balçova cable car. There is no separate ticket to buy for any of them.</p>
<h2>Where to get one</h2>
<p>Cards and tickets are sold at all seven ferry terminals — Konak, Bostanlı, Karşıyaka, Alsancak, Göztepe, Üçkuyular and Pasaport — at the central metro stations — Konak, Fahrettin Altay, Bornova, Halkapınar and Şirinyer — at the airport stations, at the Intercity Bus Terminal, and at two designated 24-hour booths.</p>
<h2>Topping up</h2>
<p>Every station has charging machines, and all ferry terminals have both machines and staffed booths during office hours. You can also top up online or through the İzmirim Kart app, which will create a digital card and let you board by QR code.</p>
<blockquote><p><strong>The online top-up trap.</strong> An online top-up is not usable immediately. It activates when you tap a validator on a vehicle, and the municipality states this takes effect after one hour. If you top up online on the way to the stop, assume it will not be there when you tap. Load at a machine if you need it now.</p></blockquote>
<h2>The 90-minute transfer is the part people miss</h2>
<p>The second and any subsequent rides within 90 minutes of your first are <strong>free</strong> — and the rule covers the whole network: metro, tram, İZBAN, the ferries and city buses alike. A ferry across the bay followed by a metro ride is one fare, not two — so long as you tap within the window.</p>
<p>The exception matters: this transfer benefit does <strong>not</strong> apply to the bus routes serving the outlying İzmir districts. Those are charged separately.</p>
<h2>Travel at the right hour and pay half</h2>
<p>A 50% discount applies to the standard tariff between 06:00–07:00 and 19:00–20:00.</p>
<h2>What a ride costs</h2>
<p>Fares change too often for a number written here to stay true — check the current tariff on the official ESHOT/İzmirim Kart pages linked below before you load the card.</p>
<h2>Card types</h2>
<p>Alongside the standard pay-as-you-go card there are reduced-fare cards for students and an electronic senior pass for the nationally-mandated free travel entitlement. If you are a foreign student, bring your residence permit and student certificate and ask at a staffed İzmirim Kart booth — the document list is theirs to confirm.</p>`

async function main() {
  const existing = await prisma.post.findUnique({ where: { slug: SLUG }, select: { id: true, status: true } })
  if (existing) {
    console.log(`✓ already exists (${existing.status}) — nothing to do`)
    return
  }

  // Articles carry the owner's byline, not the system account's — the three
  // 2026-08 posts published as "Smileys Admin" had to be reassigned by hand.
  const author = await prisma.user.findFirst({ where: { name: 'Nate G.' }, select: { id: true, name: true } })
  if (!author) throw new Error('Author "Nate G." not found')

  const city = await prisma.city.findUnique({ where: { slug: 'izmir' }, select: { id: true, name: true } })
  if (!city) throw new Error('City not found: izmir')

  console.log(`→ publish "İzmirim Kart: The Only Ticket That Matters" as ${author.name}, city ${city.name}`)
  if (DRY_RUN) { console.log('  DRY RUN — nothing written'); return }

  const now = new Date()
  const post = await prisma.post.create({
    data: {
      title:       'İzmirim Kart: The Only Ticket That Matters',
      slug:        SLUG,
      excerpt:     "One contactless card covers İzmir's metro, tram, İZBAN commuter rail, ferries, ESHOT buses and the Balçova cable car — plus a 90-minute free transfer window that most newcomers never realise they are entitled to.",
      body:        BODY,
      status:      'published',
      category:    'Getting Around',
      kind:        'handbook',
      authorId:    author.id,
      cityId:      city.id,
      publishedAt: now,
      notifiedAt:  now,
      tags:        ['izmirim kart', 'eshot', 'izban', 'metro', 'vapur', 'ulaşım', 'toplu taşıma'],
      officialSources: [
        { label: 'İzmir Büyükşehir Belediyesi — Transportation Guide', url: 'https://www.izmir.bel.tr/en/transportation-guide/494/17' },
        { label: 'İzmir Büyükşehir Belediyesi — İzmirim Kart', url: 'https://www.izmir.bel.tr/en/transportation-guide/494/1035' },
      ],
      // lastReviewedAt / reviewIntervalDays deliberately unset — see header.
    },
  })
  console.log(`✓ published ${post.slug} (${post.id})`)
}

main().then(() => process.exit(0)).catch(e => { console.error('✗', e instanceof Error ? e.message : e); process.exit(1) })
