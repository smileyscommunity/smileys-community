// Draft: "Discover İKSV" — Arts & Culture article (community post).
//
// Saved as a DRAFT only. Publishing (and the one-time "new article" bell) goes
// through the normal admin publish path once Nate has reviewed it, so
// notifiedAt is deliberately left null here.
//
// Facts checked 2026-10-15 against tiyatro.iksv.org (30th Theatre Festival
// 22 Oct – 3 Dec; Lacrima, NDT 2, Last Rites pages) and iksv.org/en; the
// per-show dates come from the festival programme as reported by Medyascope
// (the official event pages still show an empty date field).
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local scripts/draft-iksv-article.ts
//
// Idempotent (skips if the slug exists).
import { prisma } from '@/lib/prisma'

const DRY_RUN = process.env.DRY_RUN === '1'
export const IKSV_SLUG = 'discover-iksv-istanbul-arts-festivals'

const TITLE = 'Discover İKSV: The Cultural Institution Connecting Istanbul with the World'

// Doubles as the meta / OG description (app/posts/[slug] uses the excerpt).
const EXCERPT =
  "Discover İKSV, the Istanbul Foundation for Culture and Arts, and explore international film, music, theatre, contemporary dance and art events in Istanbul."

const EXT = 'target="_blank" rel="noopener noreferrer"'

const BODY = `<p>From international film festivals and live music to contemporary dance, theatre and art, İKSV has helped shape Istanbul's cultural life for more than five decades. Here's why it belongs on your cultural calendar.</p>

<p>Istanbul has much more to offer than historic landmarks, restaurants and nightlife.</p>
<p>Throughout the year, the city welcomes filmmakers, musicians, performers and artists from around the world. Some of its most interesting experiences happen in cinemas, concert halls, theatres and contemporary art spaces.</p>
<p>Behind many of these events is İKSV — the Istanbul Foundation for Culture and Arts.</p>
<p>For expats, international students, digital nomads and visitors, İKSV offers a valuable starting point for exploring Istanbul's international cultural scene.</p>

<h2>What Is İKSV?</h2>
<p>Founded in 1973, İKSV is a nonprofit cultural institution dedicated to supporting arts and culture in Istanbul.</p>
<p>Over more than five decades, it has developed a wide-ranging programme covering international cinema, music, jazz, theatre, contemporary art and cultural exchange.</p>
<p>But İKSV does more than organize festivals.</p>
<p>It supports emerging artists, commissions new works, participates in international collaborations, runs artist residency programmes and contributes to cultural policy research.</p>
<p>Its activities help connect Istanbul's creative community with artists, institutions and audiences around the world.</p>

<h2>What Can You Experience with İKSV?</h2>

<h3>International Film</h3>
<p>The Istanbul Film Festival and Filmekimi introduce audiences to international cinema, from independent productions to films recognized at major festivals.</p>
<p>For film lovers, these events provide opportunities to discover new directors, different cultures and stories that might not reach mainstream cinemas.</p>

<h3>Music and Jazz</h3>
<p>The Istanbul Music Festival and Istanbul Jazz Festival bring international performers and different musical traditions to the city.</p>
<p>Throughout the year, Fiba Salon İKSV also hosts live performances, offering opportunities to discover independent and international musicians in a more intimate setting.</p>

<h3>Theatre and Contemporary Dance</h3>
<p>The Istanbul Theatre Festival presents international theatre, contemporary dance and experimental productions.</p>
<p>For audiences interested in performing arts, it offers a chance to experience different storytelling traditions, artistic approaches and perspectives.</p>

<h3>Contemporary Art</h3>
<p>The Istanbul Biennial connects the city with international contemporary art, bringing artists and ideas into dialogue with Istanbul's cultural and social landscape.</p>
<p>İKSV also organizes learning programmes, supports artistic development and contributes to international exhibitions, including the Türkiye Pavilion at the Venice Biennale.</p>
<p>Together, these activities make İKSV an important part of Istanbul's cultural life throughout the year.</p>

<h2>Coming Up: The 30th Istanbul Theatre Festival</h2>
<p><strong>October 22 – December 3, 2026</strong></p>
<p>One of İKSV's major upcoming programmes is the 30th Istanbul Theatre Festival, featuring productions from Türkiye and abroad.</p>
<p>The festival brings together contemporary theatre, dance and performances exploring themes such as identity, relationships, communication and social change.</p>
<p>Among the international highlights are:</p>

<h3><em>Lacrima</em> — October 22–23</h3>
<p>Directed by Caroline Guiela Nguyen and presented by Théâtre National de Strasbourg, <em>Lacrima</em> explores the hidden human stories behind the creation of a luxury wedding dress.</p>
<p>Moving between different countries and cultures, the production examines invisible labour, craftsmanship and the personal sacrifices behind the fashion industry.</p>
<p>The performance combines French, Tamil, English and French Sign Language, reflecting the international world in which its story unfolds.</p>
<ul>
<li><strong>Venue:</strong> Zorlu PSM</li>
<li><strong>Language information:</strong> The production has Turkish surtitles; English surtitles are not currently listed.</li>
<li><strong>Duration:</strong> Approximately 175 minutes, without an interval. Recommended for ages 14 and over.</li>
</ul>

<h3>Nederlands Dans Theater 2 — November 27–28</h3>
<p>The internationally acclaimed Nederlands Dans Theater 2 (NDT 2) returns to Istanbul with a programme showcasing different generations of contemporary choreography.</p>
<p>The performance brings together three works:</p>
<ul>
<li><em>The Big Crying</em> — Marco Goecke</li>
<li><em>Sleepless</em> — Jiří Kylián</li>
<li>A new work — Noé Soulier</li>
</ul>
<p>Through expressive movement, technical precision and contrasting choreographic styles, the programme offers an introduction to contemporary dance for both experienced audiences and newcomers.</p>
<ul>
<li><strong>Venue:</strong> Zorlu PSM</li>
<li><strong>Duration:</strong> Approximately 120 minutes, including intervals. Recommended for ages 14 and over.</li>
</ul>

<p>The festival also features other international productions, including <em>Last Rites</em> by UK-based theatre company Ad Infinitum (November 7–8, Paribu Art; non-verbal, with Turkish surtitles and English translations on the backdrop).</p>
<p><strong>Explore the full programme and tickets:</strong> <a href="https://tiyatro.iksv.org/en" ${EXT}>tiyatro.iksv.org/en</a></p>

<h2>Can You Enjoy İKSV Events Without Speaking Turkish?</h2>
<p>Yes, although language accessibility varies by event.</p>
<p>Music and contemporary dance generally require no knowledge of Turkish. International theatre productions may use different languages, while film screenings and some stage performances provide subtitles or surtitles.</p>
<p>However, <strong>English accessibility is not guaranteed</strong>.</p>
<p>Before booking, check each event's language information carefully, particularly for theatre performances.</p>
<p>İKSV's English-language websites make it easier for international audiences to explore programmes and find practical information.</p>

<h2>Discover a Different Side of Istanbul</h2>
<p>Moving to a new city often begins with discovering its restaurants, neighborhoods and social life.</p>
<p>But culture offers another way to understand a place.</p>
<p>A film from a country you've never visited, a concert by an unfamiliar musician or a theatre performance exploring a different perspective can introduce you to new ideas.</p>
<p>You don't need to be an art expert to enjoy these experiences. Sometimes curiosity is enough.</p>
<p>And sharing a cultural experience with someone else can be the beginning of a great conversation.</p>

<h2>Explore Istanbul's Cultural Scene with Smileys Community</h2>
<p>At Smileys Community, we believe international living is about more than meeting people from different countries. It's also about discovering new experiences and cultures together.</p>
<p>That's why we're expanding our English-language coverage of Istanbul's international concerts, festivals, exhibitions, films and performances.</p>
<p>Our goal is to help expats, Erasmus students, digital nomads and internationally minded locals discover more of what Istanbul has to offer.</p>
<p>Whether you're new to the city or have lived here for years, İKSV's year-round programme offers plenty of reasons to explore something different.</p>
<ul>
<li><a href="https://www.iksv.org/en" ${EXT}>Discover İKSV</a></li>
<li><a href="https://tiyatro.iksv.org/en" ${EXT}>Explore the Istanbul Theatre Festival</a></li>
<li><a href="https://smileyscommunity.com/app">Join Smileys Community</a></li>
</ul>`

async function main() {
  const existing = await prisma.post.findUnique({ where: { slug: IKSV_SLUG }, select: { id: true, status: true } })
  if (existing) { console.log(`✓ already exists (${existing.status}) — nothing to do`); return }

  const author = await prisma.user.findFirst({
    where:  { name: 'Nate G.', role: { in: ['admin', 'moderator'] } },
    select: { id: true, name: true },
  })
  if (!author) throw new Error('Author "Nate G." not found')
  const city = await prisma.city.findUnique({ where: { slug: 'istanbul' }, select: { id: true, name: true } })
  if (!city) throw new Error('Istanbul city row not found')

  console.log(`→ draft "${TITLE}"`)
  console.log(`  slug     /posts/${IKSV_SLUG}`)
  console.log(`  category Arts & Culture · city ${city.name} · author ${author.name}`)
  console.log(`  excerpt  ${EXCERPT.length} chars`)
  if (DRY_RUN) { console.log('\n  DRY RUN — nothing written'); return }

  const post = await prisma.post.create({
    data: {
      title: TITLE, slug: IKSV_SLUG, excerpt: EXCERPT, body: BODY,
      status: 'draft', category: 'Arts & Culture', kind: 'community',
      authorId: author.id, cityId: city.id, coverImage: null,
    },
    select: { id: true },
  })
  console.log(`✓ drafted ${post.id}`)
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
