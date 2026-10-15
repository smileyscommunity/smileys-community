// Draft: "Uzakrota Global 2026" — Business & Networking event preview (community post).
//
// Saved as a DRAFT only. Publishing (and the one-time "new article" bell) goes
// through the normal admin publish path once Nate has reviewed it, so
// notifiedAt is deliberately left null here. No cover image: the AI-generated
// illustration carries unverified Uzakrota branding, so the hero is left for a
// manual upload (licensed press image from Uzakrota, or an unbranded one).
//
// Facts checked 2026-10-15 against uzakrota.com/summit26 (header: November 27,
// 09:00-17:00, Hilton Istanbul Bosphorus Convention Center, single-day pass
// "FREE", projections 15.000 visitors / 150 speakers / 30 sessions / 110
// countries) and its Eventbrite listing (Friday Nov 27, 09:00-18:00).
// KNOWN SOURCE CONFLICTS, deliberately resolved to the header date and the
// official page's hours: its "About" paragraph says the 28th; Eventbrite shows a
// 18:00 end and a stray "2025" in its description.
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local scripts/draft-uzakrota-article.ts
//
// Idempotent (skips if the slug exists).
import { prisma } from '@/lib/prisma'
import { parseEventDetails } from '@/lib/postEventDetails'

const DRY_RUN = process.env.DRY_RUN === '1'
export const UZAKROTA_SLUG = 'uzakrota-global-2026-istanbul'

const TITLE = 'Uzakrota Global 2026: Istanbul Welcomes the World of Travel'

// Doubles as the meta / OG description (app/posts/[slug] uses the excerpt).
const EXCERPT =
  'Discover Uzakrota Global 2026 in Istanbul on November 27. Explore AI, travel technology and international networking with free conference registration.'

const EXT = 'target="_blank" rel="noopener noreferrer"'
const OFFICIAL = 'https://www.uzakrota.com/summit26/'

// Public facts for the "Event details" card. No ticketUrl on purpose: that card's
// button reads "Buy your ticket", which is wrong for a free pass — registration
// is the prominent link in the body instead.
const EVENT_DETAILS = {
  eventDate: '2026-11-27',
  startTime: '09:00',
  timeConfirmed: true,
  venue: 'Hilton Istanbul Bosphorus Convention Center',
  district: 'Şişli',
}

const BODY = `<p>From artificial intelligence and travel technology to aviation, hospitality and international networking, Uzakrota Global returns to Istanbul on November 27 — with a free single-day pass.</p>

<p>On Friday, November 27, 2026, Istanbul will host Uzakrota Global 2026, an international travel and tourism summit for industry professionals, entrepreneurs and businesses.</p>

<p><strong>Register for Uzakrota Global 2026:</strong> <a href="${OFFICIAL}" ${EXT}>${OFFICIAL.replace('https://', '')}</a></p>

<h2>What Is Uzakrota Global?</h2>
<p>Uzakrota Global is a travel industry summit organized by Uzakrota. According to the organizer, it connects companies and professionals across tour operators, MICE, airlines, hotels, online travel agencies, travel technology and tourism boards.</p>
<p>The organizer's projections for the 2026 edition are 15,000 visitors from 110 countries, with 150 speakers across 30 sessions.</p>
<p>These figures are the organizer's expectations, not confirmed attendance.</p>

<h2>How Technology Is Changing the Travel Industry</h2>
<p>Travel is changing rapidly, and it is no longer just about destinations, hotels and airline tickets.</p>
<p>Technology increasingly influences how people discover places, compare prices, make reservations and organize their journeys.</p>
<p>Artificial intelligence, automated customer service, digital payments and booking platforms are creating new opportunities and challenges for businesses.</p>
<p>The sectors the organizer says the summit covers include:</p>
<ul>
<li><strong>Travel technology and online travel agencies:</strong> digital booking platforms and new business models.</li>
<li><strong>Airlines:</strong> developments affecting carriers and international connectivity.</li>
<li><strong>Hotels and tour operators:</strong> how accommodation and trip providers reach international travelers.</li>
<li><strong>Tourism boards:</strong> how cities and countries attract visitors in a competitive global market.</li>
<li><strong>MICE:</strong> meetings, incentives, conferences and exhibitions.</li>
</ul>
<p>Which of these topics get a dedicated session is for the organizer to say.</p>

<h2>Why International Networking Matters</h2>
<p>One of the summit's main attractions is the chance to meet people working across different parts of the travel industry.</p>
<p>A startup developing a tourism application might connect with a hotel group. A destination marketer could meet international travel companies. A technology professional might discover opportunities in hospitality or aviation.</p>
<p>These encounters don't necessarily lead to immediate business deals, but they can introduce new perspectives, markets and professional relationships.</p>
<p>For entrepreneurs and internationally mobile professionals living in Istanbul, such gatherings are a way to engage with a wider business community.</p>

<h2>Is Uzakrota Relevant for Expats and Digital Nomads?</h2>
<p>Uzakrota is not specifically a digital-nomad event, but several of its sectors are relevant to people who live and work internationally.</p>
<p>Many expats and remote professionals work in industries connected to travel, including technology, marketing, hospitality, tourism, consulting and entrepreneurship.</p>
<p>For founders building travel-related businesses, freelancers interested in hospitality projects or professionals looking to expand their networks, the summit could be particularly interesting.</p>
<p>Approach it as a professional industry event rather than a general travel exhibition for consumers.</p>

<h2>Uzakrota Global 2026: Date, Venue and Registration</h2>
<ul>
<li><strong>Time:</strong> 09:00–17:00, per the official website</li>
<li><strong>Address:</strong> Cumhuriyet Caddesi No:50, Harbiye, Şişli, Istanbul</li>
<li><strong>Organizer:</strong> Uzakrota</li>
<li><strong>Admission:</strong> Single-day pass listed as free</li>
</ul>
<p>The official page lists the conference and the booth area under the free single-day pass, but does not spell out exactly what it covers. Check the details when you register.</p>
<p>Exhibitor booths and other participation packages are sold separately and have their own conditions and prices.</p>
<p>Register in advance and check the official website for current availability, confirmed speakers and programme updates.</p>
<p><strong>Official website and registration:</strong> <a href="${OFFICIAL}" ${EXT}>${OFFICIAL.replace('https://', '')}</a></p>

<h2>Discover Istanbul's International Business Scene with Smileys Community</h2>
<p>At Smileys Community, we believe international living is about more than meeting people from different countries. It's also about exchanging ideas, discovering opportunities and building meaningful connections.</p>
<p>Our community brings together expats, digital nomads, entrepreneurs, international students and globally minded locals from diverse backgrounds.</p>
<p>That's why we're expanding our English-language coverage of international conferences, professional networking opportunities, technology events and cultural gatherings in Istanbul.</p>
<p>Whether you work in travel, are developing your own business or simply want to understand how the industry is evolving, Uzakrota Global 2026 could be an interesting opportunity to expand your perspective.</p>
<p><em>This is an independent editorial preview. Smileys Community is not an official Uzakrota partner.</em></p>
<ul>
<li><a href="https://smileyscommunity.com/app">Discover Smileys Community</a></li>
</ul>`

async function main() {
  const existing = await prisma.post.findUnique({ where: { slug: UZAKROTA_SLUG }, select: { id: true, status: true } })
  if (existing && process.env.UPDATE_BODY === '1' && (existing.status === 'draft' || process.env.ALLOW_PUBLISHED === '1')) {
    console.log(`→ updating body of draft ${existing.id}`)
    if (DRY_RUN) { console.log('  DRY RUN — nothing written'); return }
    await prisma.post.updateMany({ where: { id: existing.id, status: existing.status }, data: { body: BODY } })
    console.log('✓ body updated'); return
  }
  if (existing) { console.log(`✓ already exists (${existing.status}) — nothing to do`); return }

  const dupes = await prisma.post.findMany({
    where: { OR: [{ title: { contains: 'Uzakrota', mode: 'insensitive' } }, { slug: { contains: 'uzakrota' } }] },
    select: { slug: true, status: true },
  })
  if (dupes.length) throw new Error(`a Uzakrota post already exists: ${JSON.stringify(dupes)}`)

  // "Smileys Community" has no author row of its own; fall back to the default
  // host the other editorial drafts use.
  const author = await prisma.user.findFirst({
    where:  { name: 'Nate G.', role: { in: ['admin', 'moderator'] } },
    select: { id: true, name: true },
  })
  if (!author) throw new Error('Author "Nate G." not found')
  const city = await prisma.city.findUnique({ where: { slug: 'istanbul' }, select: { id: true, name: true } })
  if (!city) throw new Error('Istanbul city row not found')

  const details = parseEventDetails(EVENT_DETAILS)
  if (!details || Object.keys(details).length < 5) throw new Error('eventDetails failed validation')

  console.log(`→ draft "${TITLE}"`)
  console.log(`  slug     /posts/${UZAKROTA_SLUG}`)
  console.log(`  category Business & Networking · city ${city.name} · author ${author.name}`)
  console.log(`  excerpt  ${EXCERPT.length} chars`)
  console.log(`  event    ${JSON.stringify(details)}`)
  if (DRY_RUN) { console.log('\n  DRY RUN — nothing written'); return }

  const post = await prisma.post.create({
    data: {
      title: TITLE, slug: UZAKROTA_SLUG, excerpt: EXCERPT, body: BODY,
      status: 'draft', category: 'Business & Networking', kind: 'community',
      authorId: author.id, cityId: city.id, coverImage: null, eventDetails: { ...details },
    },
    select: { id: true },
  })
  console.log(`✓ drafted ${post.id}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
