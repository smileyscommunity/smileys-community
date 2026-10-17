// Draft: "Argentine Cinema Comes to Kadıköy" — Arts & Culture article (community post).
//
// Saved as a DRAFT only. Publishing (and the one-time "new article" bell) goes
// through the normal admin publish path once Nate has reviewed it, so
// notifiedAt is deliberately left null here.
//
// Editorial coverage of an EXTERNAL programme: Sinematek/Sinema Evi's
// "A Look at Argentine Cinema" (Kadıköy Municipality, with the Argentine
// Consulate and Lumiton). No Smileys event, RSVP, offer or group outing is
// created or implied. The official name is "A Look at Argentine Cinema" —
// never "Argentine Film Days".
//
// Scope: Istanbul only (cityId istanbul) — the venue is in Kadıköy.
//
// SEO: app/posts/[slug] builds the <title> as "{title} — Smileys Community"
// and uses the excerpt as the meta / OG description. There is no per-post SEO
// title or separate meta description field, so the brief's SEO title ("…|
// Smileys Community") and its longer meta description have nowhere to go; the
// brief's card excerpt is stored and does both jobs.
//
// The article page renders the excerpt as the standfirst under the title, so
// the body starts at the next paragraph rather than repeating it.
//
// eventDetails: the "Event details" card carries the venue, the language and
// the subtitle facts (Spanish audio, Turkish subtitles, English not listed) so
// they are easy to spot, plus the official Mobilet ticket link. No eventDate
// or startTime: this is a multi-month programme with per-film dates, which
// the body lists. No `benefit` — there is no Smileys offer.
//
// Author: "Smileys Community" staff account if one exists, otherwise "Nate G."
// (same rule as the other editorial drafts).
//
// Hero image: none supplied. Leave empty; a later commissioned image must not
// contain the Smileys logo or a smiley-face symbol, and no film still or
// poster without permission. Attach with COVER=/app/api/files/… UPDATE_COVER=1.
//
// Facts checked 2026-10-17 against the Sinematek programme page and each
// film's detail page; the two Oscar wins against the Academy ceremony pages
// (1986, 2010). The English Nine Queens page shows an inconsistent year on its
// January screening, so only its 3 Nov and 6 Dec dates are used. If the draft
// is published late, recheck the screening dates first.
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local scripts/draft-argentine-cinema-article.ts
//   npx tsx --env-file=.env --env-file=.env.local scripts/draft-argentine-cinema-article.ts
//   UPDATE_BODY=1 …   rewrite title/excerpt/body/tags/eventDetails of the draft (draft only)
//   COVER=/app/api/files/… UPDATE_COVER=1 …   attach the hero image
//
// Idempotent (skips if the slug exists).
import { prisma } from '@/lib/prisma'
import { parseEventDetails } from '@/lib/postEventDetails'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'

const DRY_RUN = process.env.DRY_RUN === '1'
export const ARGENTINE_CINEMA_SLUG = 'argentine-cinema-istanbul-sinematek-2026'

const TITLE = 'Argentine Cinema Comes to Kadıköy: Secrets, Swindlers and Stories That Stay With You'

// Doubles as the standfirst and the meta / OG description (app/posts/[slug]).
const EXCERPT =
  'From 23 October 2026, Sinematek/Sinema Evi invites Istanbul audiences into a world of family secrets, dangerous memories and very convincing liars.'

const TAGS = ['Argentine cinema', 'Istanbul', 'Kadıköy', 'Sinematek', 'film screenings']

const EVENT_DETAILS = {
  venue:     'Sinematek/Sinema Evi, Osmanağa Mahallesi, Hasırcı Sokak No. 16',
  district:  'Kadıköy',
  language:  'Spanish (some Narcisa Hirsch shorts are dialogue-free)',
  subtitles: 'Turkish subtitles; English subtitles not listed',
  ticketUrl: 'https://mobilet.com/tr/parent-event-detail/sinematek-sinema-evi-26/',
}

const EXT = 'target="_blank" rel="noopener noreferrer"'

const BODY = `<p>Two strangers strike up a conversation. A mother starts asking questions. A family gathers for a summer that feels increasingly uncomfortable. Somewhere in the audience, you realise your quiet cinema evening has become something much more absorbing.</p>
<p>That is the appeal of “A Look at Argentine Cinema,” the new programme at Kadıköy Municipality’s Sinematek/Sinema Evi. With screenings scheduled from 23 October 2026 to 17 January 2027, it brings together crime stories, political dramas, documentaries and experimental work. Organised in collaboration with the Argentine Consulate and Lumiton, the selection offers several ways into a country through the stories its filmmakers tell.</p>
<p>Come for a good story. You might leave with a new favourite filmmaker.</p>

<h2>Start with a secret</h2>
<p>If you like a mystery with emotional weight, put <em>The Secret in Their Eyes</em> on your list. Juan José Campanella’s 2009 film, which won the 2010 Oscar for Best Foreign Language Film, follows a retired man revisiting an old murder investigation. The case pulls him back towards memories and feelings that have proved much harder to put away than the paperwork.</p>
<p>With Ricardo Darín and Soledad Villamil in the cast, it is our suggested starting point for anyone who wants suspense, human chemistry and something to discuss afterwards. Its first screening is Friday, 30 October at 20:00, with further showings on 22 November and 19 December.</p>
<p>Prefer your secrets with a side of dishonesty? Try <em>Nine Queens</em>. Fabián Bielinsky’s 2000 film pairs two con artists whose working relationship becomes a test of trust. The pleasure is in watching people who make their living reading others try to read each other. Resist the temptation to investigate the plot beforehand. Its first screening is Tuesday, 3 November at 20:00, followed by another on 6 December.</p>

<h2>When the personal becomes political</h2>
<p><em>The Official Story</em> begins with a question that could unravel a family: where did an adopted child really come from? Luis Puenzo’s 1985 drama, which won the 1986 Oscar for Best Foreign Language Film, follows a Buenos Aires history teacher whose search forces her to confront the violence behind the life she knows.</p>
<p>It is a compelling choice for viewers interested in memory, responsibility and the things people allow themselves to believe. Catch it on Saturday, 24 October at 14:00, with repeat screenings on 21 November and 29 December.</p>
<p>Opening film <em>The Swamp</em> takes a different route into social tensions. Lucrecia Martel’s 2001 debut places us among families spending a stifling summer in provincial Argentina. Class, discomfort and strained relationships seep into the everyday. Choose this one if atmosphere and family dynamics draw you in. It opens the programme on Friday, 23 October at 20:00, returning on 22 November and 26 December.</p>

<h2>A little romance, a little absurdity</h2>
<p>There is more to explore beyond these four films. María Luisa Bemberg’s <em>Camila</em> tells a story of forbidden love, while Martín Rejtman’s <em>The Magic Gloves</em> follows a taxi driver into a series of absurd encounters. For something more experimental, the Narcisa Hirsch shorts programme explores intimacy, memory and women’s experiences through a very different kind of filmmaking. Pick according to your curiosity; the programme leaves room to change moods.</p>

<h2>Which film suits your evening?</h2>
<p>Our picks:</p>
<ul>
<li><strong>A lively night with friends:</strong> <em>Nine Queens</em>.</li>
<li><strong>Mystery with an emotional pull:</strong> <em>The Secret in Their Eyes</em>.</li>
<li><strong>A conversation that continues over coffee:</strong> <em>The Official Story</em>.</li>
<li><strong>An adventurous choice for atmosphere lovers:</strong> <em>The Swamp</em>.</li>
</ul>
<p>For Smileys readers, this is an invitation to try a different kind of night out: choose a film with a friend, then leave time for a conversation afterwards. Agreeing on what you have just watched is entirely optional.</p>

<h2>Before you book</h2>
<p>The venue is Sinematek/Sinema Evi, Osmanağa Mahallesi, Hasırcı Sokak No. 16, Kadıköy. Tickets are sold exclusively through Mobilet; check the booking page for current prices and availability.</p>
<p><strong>Language matters:</strong> the four main picks, <em>Camila</em> and <em>The Magic Gloves</em> are listed in Spanish with Turkish subtitles. The Hirsch programme combines Spanish-language and dialogue-free shorts. <strong>English subtitles are not listed for these screenings.</strong> Check individual film details before booking, particularly if you do not understand Spanish or Turkish.</p>
<p>Seating is unnumbered and late entry is not permitted. Screenings are generally restricted to adults aged 18 and over unless the programme states otherwise. Arrive early, settle in and give the film your full attention. The conversation can wait until the lights come up.</p>

<h2>Official programme and booking</h2>
<ul>
<li><a href="https://en-sinematek.kadikoy.bel.tr/Program/AnaListe?slug=a-look-at-argentine-cinema-29-09-2026" ${EXT}>A Look at Argentine Cinema: full programme and screening dates</a></li>
<li><a href="https://mobilet.com/tr/parent-event-detail/sinematek-sinema-evi-26/" ${EXT}>Buy tickets on Mobilet</a></li>
<li><a href="https://en-sinematek.kadikoy.bel.tr/page/practical-information" ${EXT}>Sinematek visitor information</a></li>
<li><a href="https://en-sinematek.kadikoy.bel.tr/page/contact" ${EXT}>Sinematek/Sinema Evi venue and contact details</a></li>
</ul>`

async function main() {
  const details = parseEventDetails(EVENT_DETAILS)
  if (!details || Object.keys(details).length !== 5) throw new Error('eventDetails failed validation')

  const existing = await prisma.post.findUnique({ where: { slug: ARGENTINE_CINEMA_SLUG }, select: { id: true, status: true } })

  if (existing && process.env.UPDATE_COVER === '1') {
    const cover = process.env.COVER ?? ''
    // Same rule the admin cover field enforces: our own uploads only.
    if (!isUploadedImageUrl(cover)) throw new Error(`COVER must be an uploaded file path (/app/api/files/…), got "${cover}"`)
    console.log(`→ cover of ${existing.id} (${existing.status}) → ${cover}`)
    if (DRY_RUN) { console.log('  DRY RUN — nothing written'); return }
    await prisma.post.update({ where: { id: existing.id }, data: { coverImage: cover } })
    console.log('✓ cover set'); return
  }
  if (existing && process.env.UPDATE_BODY === '1') {
    if (existing.status !== 'draft') { console.log(`✗ ${existing.status}, not a draft — edit it in the admin instead`); return }
    console.log(`→ updating draft ${existing.id}`)
    if (DRY_RUN) { console.log('  DRY RUN — nothing written'); return }
    await prisma.post.updateMany({
      where: { id: existing.id, status: 'draft' },
      data:  { title: TITLE, excerpt: EXCERPT, body: BODY, tags: TAGS, category: 'Arts & Culture', eventDetails: { ...details } },
    })
    console.log('✓ draft updated'); return
  }
  if (existing) { console.log(`✓ already exists (${existing.status}) — nothing to do (UPDATE_BODY=1 to rewrite the draft)`); return }

  // Guard against a duplicate under another slug (e.g. a hand-made draft).
  const dupes = await prisma.post.findMany({
    where: { OR: [{ title: { contains: 'Argentin', mode: 'insensitive' } }, { slug: { contains: 'argentin' } }] },
    select: { slug: true, status: true },
  })
  if (dupes.length) throw new Error(`an Argentine cinema post already exists — update that one instead: ${JSON.stringify(dupes)}`)

  const staff = { role: { in: ['admin', 'moderator'] } }
  const author =
    await prisma.user.findFirst({ where: { name: 'Smileys Community', ...staff }, select: { id: true, name: true } }) ??
    await prisma.user.findFirst({ where: { name: 'Nate G.', ...staff }, select: { id: true, name: true } })
  if (!author) throw new Error('No author: neither "Smileys Community" nor "Nate G." staff account found')
  if (author.name !== 'Smileys Community') console.log('  ⚠ no "Smileys Community" staff account — byline falls back to Nate G.')

  const city = await prisma.city.findUnique({ where: { slug: 'istanbul' }, select: { id: true, name: true } })
  if (!city) throw new Error('Istanbul city row not found')

  console.log(`→ draft "${TITLE}"`)
  console.log(`  slug     /posts/${ARGENTINE_CINEMA_SLUG}`)
  console.log(`  category Arts & Culture · city ${city.name} · author ${author.name}`)
  console.log(`  tags     ${TAGS.join(', ')}`)
  console.log(`  excerpt  ${EXCERPT.length} chars · body ${BODY.length} chars`)
  console.log(`  event    ${JSON.stringify(details)}`)
  if (DRY_RUN) { console.log('\n  DRY RUN — nothing written'); return }

  const post = await prisma.post.create({
    data: {
      title: TITLE, slug: ARGENTINE_CINEMA_SLUG, excerpt: EXCERPT, body: BODY, tags: TAGS,
      status: 'draft', category: 'Arts & Culture', kind: 'community',
      authorId: author.id, cityId: city.id, coverImage: null, eventDetails: { ...details },
    },
    select: { id: true },
  })
  console.log(`✓ drafted ${post.id} — preview at /app/posts/${ARGENTINE_CINEMA_SLUG}`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
