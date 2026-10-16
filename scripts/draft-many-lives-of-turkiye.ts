// Draft: "The Many Lives of Türkiye" — Heritage & Traditions article (community post).
//
// Saved as a DRAFT only. Publishing (and the one-time "new article" bell) goes
// through the normal admin publish path once Nate has reviewed it, so
// notifiedAt is deliberately left null here.
//
// Scope: Türkiye-wide (cityId null, country 'TR'). The piece moves between
// İzmir, the Black Sea, Mardin and Istanbul, so it belongs on every Turkish
// city's /posts and on no non-Turkish one (lib/postScope.ts).
//
// Category: 'Heritage & Traditions', added for pieces like this one; the
// brief's "Culture" would have collided with 'Arts & Culture'.
//
// Copy is the publishing brief's corrected text, wording unchanged. The
// numbered references become small grey bracketed links straight to each
// source. The article sanitizer has no <sup>, class or id, so there are no
// in-page anchors: a <span style="color"> is the only styling that survives,
// and BODY_PROSE makes links inside a coloured span inherit its colour.
//
// SEO: app/posts/[slug] builds the <title> as "{title} — Smileys Community"
// and uses the excerpt as the meta / OG description. There is no per-post SEO
// title or separate meta description, so the brief's card excerpt is stored
// as the excerpt and does both jobs (145 chars).
//
// Author: the brief says "Smileys Community". Uses a staff account with that
// exact name if one exists, otherwise falls back to "Nate G." and says so.
//
// Hero image: none yet. Upload it through the admin editor, or attach it
// afterwards with COVER=/app/api/files/<path> UPDATE_COVER=1.
//
// Facts spot-checked 2026-10-16: TÜİK ADNKS 2025 (86,092,168, announced Feb
// 2026); the gov.uk Kurds CPIN at the cited URL is titled July 2025 despite
// "october-2023" in its slug.
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local scripts/draft-many-lives-of-turkiye.ts
//   npx tsx --env-file=.env --env-file=.env.local scripts/draft-many-lives-of-turkiye.ts
//   UPDATE_BODY=1 …   rewrite title/excerpt/body/tags of the draft (draft only)
//   COVER=/app/api/files/… UPDATE_COVER=1 …   attach the hero image
//
// Idempotent (skips if the slug exists).
import { prisma } from '@/lib/prisma'
import { isUploadedImageUrl } from '@/lib/uploadedImageUrl'

const DRY_RUN = process.env.DRY_RUN === '1'
export const TURKIYE_SLUG = 'the-many-lives-of-turkiye'

const TITLE = 'The Many Lives of Türkiye'

// Card excerpt; doubles as the meta / OG description (app/posts/[slug]).
const EXCERPT =
  'From Ladino songs in İzmir to Syriac traditions near Mardin, discover the languages, family histories and communities that shape life in Türkiye.'

const TAGS = ['Türkiye', 'Culture', 'Languages', 'Heritage', 'Community', 'Expat Life']

const EXT = 'target="_blank" rel="noopener noreferrer"'

const SOURCES: Record<number, string> = {
  1:  'https://izmirjcc.org/heritage/sephardic-culture/',
  2:  'https://www.agos.com.tr/en/hrant-dink',
  3:  'https://whc.unesco.org/en/tentativelists/6534/',
  4:  'https://veriportali.tuik.gov.tr/en/press/53899/metadata',
  5:  'https://www.gov.uk/government/publications/turkey-country-policy-and-information-notes/country-policy-and-information-note-kurds-turkey-october-2023-accessible',
  6:  'https://www.visitizmir.org/en/Content/235',
  7:  'https://www.lazenstitu.com/lazca-nasil-bir-dildir/',
  8:  'https://www.kafdav.org.tr/cerkeslerin-surgunu-21-mayis-1864',
  9:  'https://www.mfa.gov.tr/lausanne-peace-treaty-vi_-convention-concerning-the-exchange-of-greek-and-turkish-populations-signed-at-lausanne_.en.mfa',
  10: 'https://minorityrights.org/country/turkey/',
  11: 'https://www.ecoi.net/en/document/1455484.html',
}

// A discreet, grey "[1, 2]" whose numbers each link to their source.
function ref(...nums: number[]): string {
  const links = nums.map(n => `<a href="${SOURCES[n]}" ${EXT}>${n}</a>`).join(', ')
  return ` <span style="color: #9ca3af">[${links}]</span>`
}

const a = (href: string, label: string) => `<a href="${href}" ${EXT}>${label}</a>`

const BODY = `<p>A Ladino song in İzmir. An Armenian newspaper in Istanbul. An Aramaic language still spoken near Mardin. Getting to know the country means following stories like these.</p>

<p>A Ladino song from İzmir’s Jewish community can carry words with roots in fifteenth-century Spanish. In Istanbul, a newspaper founded in 1996 publishes in Turkish and Armenian. Around Midyat, the language of a conversation may be Turoyo, a modern Neo-Aramaic language.</p>
<p>All three belong to Türkiye. Each opens a different door into the country.${ref(1, 2, 3)}</p>
<p>For anyone who has recently arrived, “Turkish culture” is a useful phrase until it starts doing too much work. It can describe a shared language, familiar customs and national life. But it can also hide the differences between families whose histories, beliefs and ideas of belonging are quite distinct.</p>
<p>TÜİK recorded a resident population of 86,092,168 as of 31 December 2025. Ethnic Turks form the majority, and Kurds are the largest ethnic and linguistic minority. Precise percentages deserve caution: there is no current official census breakdown by ethnicity. The more interesting question is how those identities are lived.${ref(4, 5)}</p>
<p>Take İzmir. Its familiar image of waterfront cafés and Aegean food leaves plenty to discover in the streets behind the coast. Around Kemeraltı, historic synagogues preserve the history of a Jewish community with a rich Sephardic inheritance.${ref(6)}</p>
<p>One thread is Ladino, or Judeo-Spanish. It developed from varieties of Spanish carried by Sephardic Jews after the expulsions from Spain in 1492, taking in influences from Hebrew and languages encountered in new homes, including Turkish, Greek and French. It continued to evolve over the centuries. Songs, sayings and recipes became ways of carrying that inheritance forward. Today, documenting and teaching Ladino raises an intimate question: what happens to a family’s memories when younger generations no longer speak the language in which they were told?${ref(1)}</p>
<p>A similar question makes a Black Sea journey more interesting. Laz is a language in its own right, belonging to the Kartvelian family, which also includes Georgian. It has roots in communities around parts of Rize and Artvin. Calling every Black Sea resident “Laz,” or imagining Laz to be a colourful Turkish accent, misses that distinction.${ref(7)}</p>
<p>The Laz Institute’s work on language survival brings the issue into the present. Keeping a language alive requires speakers, teaching materials and opportunities to use it. For a visitor, learning that difference changes what you hear. For a family, it can change what a child is able to understand from a grandparent.${ref(7)}</p>
<p>Travel southeast towards Mardin and Midyat and another story comes into focus. The Syriac Orthodox churches and monasteries of Tur Abdin belong to a long Christian tradition rooted in the region. Classical Syriac remains a language of worship, while Turoyo, a distinct modern Neo-Aramaic language, is still spoken locally. The relationship between a community, its faith and its language is part of the landscape you have come to see.${ref(3)}</p>
<p>In Istanbul, Armenian life has a public voice through Agos. Founded in 1996, the newspaper set out to reach both Armenian-speaking readers and Armenians who could no longer speak their ancestral language, while sharing community concerns with a wider Turkish-speaking public. Its bilingual pages offer a revealing example of identity adapting across generations.${ref(2)}</p>
<p>The histories behind these communities take different paths. Some communities have deep roots in the places where they live. Others carry histories of migration, refuge or expulsion.</p>
<p>Circassian family histories, for example, often reach back to the nineteenth-century expulsions from the Caucasus, particularly 1864. The compulsory population exchange agreed in 1923 required Greek Orthodox Turkish nationals to move to Greece and Muslim Greek nationals to move to Türkiye. Exceptions included qualifying Greek residents of Istanbul and Muslims in Western Thrace. Religion, alongside nationality and residence, defined who was covered by the agreement. Behind the language of treaties were people leaving houses, neighbours and places they knew as home.${ref(8, 9)}</p>
<p>That helps explain why a family’s attachment to a village, a song or a recipe can carry so much weight. What looks like a small tradition to an outsider may hold the memory of a place the family lost.</p>
<p>Kurdish life brings another dimension. Its deep roots in the east and southeast extend into cities across Türkiye. Newroz celebrations, storytelling and music connect generations, while Kurdish identity continues to develop through contemporary urban life. Long-established Arab communities, Georgians, Roma, Bosniaks, Albanians and many others have their own experiences within the wider country. No short list can give each of them the space they deserve.${ref(10)}</p>
<p>Faith crosses these identities, too. Sunni Islam is the largest religious tradition, but being Muslim does not tell you someone’s ethnicity or how they practise. Alevis include people of Turkish and Kurdish backgrounds; Alevi-Bektaşi traditions include cem rituals and semah, which brings music and movement into communal worship. Alevis themselves differ in how they describe their relationship with Islam. Nationality, ancestry and belief rarely fit into separate, tidy boxes.${ref(11)}</p>
<p>For someone making a life in Türkiye, all of this offers a more rewarding kind of discovery. A neighbourhood walk can lead to a community newspaper. A song can lead to a language you did not know was spoken here. A friendship can reveal why a hometown remains important decades after a family moved away.</p>
<p>There is pleasure in those discoveries, and sometimes discomfort. People may speak about discrimination, silence or traditions they were discouraged from practising. Those experiences belong in the conversation alongside the food and festivals.</p>
<p>At the next shared table, ask where a song comes from, what language someone grew up hearing, or which family tradition they hope to keep. Then give the answer time. You may discover a Türkiye that has been beside you all along.</p>

<hr>
<h3>Sources and further reading</h3>
<ol>
<li>${a(SOURCES[1], 'İzmir Jewish Community — Sephardic culture and Ladino')}</li>
<li>${a(SOURCES[2], 'Agos — Hrant Dink and the newspaper’s founding purpose')}</li>
<li>${a(SOURCES[3], 'UNESCO — Churches and monasteries of Midyat and Tur Abdin')}</li>
<li>${a(SOURCES[4], 'TÜİK — Address Based Population Registration System, 2025')}. <em>Methodology note: the published resident population includes eligible foreign residents but excludes Syrians under temporary protection and certain short-term foreign visitors. It is not a count of citizens alone or everyone physically present.</em></li>
<li>${a(SOURCES[5], 'UK Home Office — Country policy and information note: Kurds, July 2025')}</li>
<li>${a(SOURCES[6], 'Visit İzmir — Jewish Heritage Route')}</li>
<li>${a(SOURCES[7], 'Laz Institute — The Laz language')} · ${a('https://www.lazenstitu.com/the-current-status-of-the-laz-language-in-turkey-2018/', 'Language survival report')}</li>
<li>${a(SOURCES[8], 'KAFDAV — Circassian exile, 21 May 1864')}</li>
<li>${a(SOURCES[9], 'Republic of Türkiye Ministry of Foreign Affairs — 1923 population exchange convention')}</li>
<li>${a(SOURCES[10], 'Minority Rights Group — Türkiye')} · ${a('https://minorityrights.org/communities/kurds-2/', 'Kurds')} · ${a('https://thekurdishproject.org/history-and-culture/kurdish-culture/kurdish-newroz/', 'The Kurdish Project — Newroz')}</li>
<li>${a(SOURCES[11], 'Immigration and Refugee Board of Canada — Alevi identity and traditions')} · ${a('https://ich.unesco.org/en/RL/semah-alevi-bektasi-ritual-00384', 'UNESCO — Semah')}</li>
</ol>`

async function main() {
  const existing = await prisma.post.findUnique({ where: { slug: TURKIYE_SLUG }, select: { id: true, status: true } })

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
      data:  { title: TITLE, excerpt: EXCERPT, body: BODY, tags: TAGS, category: 'Heritage & Traditions' },
    })
    console.log('✓ draft updated'); return
  }
  if (existing) { console.log(`✓ already exists (${existing.status}) — nothing to do`); return }

  const staff = { role: { in: ['admin', 'moderator'] } }
  const author =
    await prisma.user.findFirst({ where: { name: 'Smileys Community', ...staff }, select: { id: true, name: true } }) ??
    await prisma.user.findFirst({ where: { name: 'Nate G.', ...staff }, select: { id: true, name: true } })
  if (!author) throw new Error('No author: neither "Smileys Community" nor "Nate G." staff account found')
  if (author.name !== 'Smileys Community') console.log('  ⚠ no "Smileys Community" staff account — byline falls back to Nate G.')

  console.log(`→ draft "${TITLE}"`)
  console.log(`  slug     /posts/${TURKIYE_SLUG}`)
  console.log(`  category Heritage & Traditions · Türkiye-wide (country TR) · author ${author.name}`)
  console.log(`  tags     ${TAGS.join(', ')}`)
  console.log(`  excerpt  ${EXCERPT.length} chars · body ${BODY.length} chars`)
  if (DRY_RUN) { console.log('\n  DRY RUN — nothing written'); return }

  const post = await prisma.post.create({
    data: {
      title: TITLE, slug: TURKIYE_SLUG, excerpt: EXCERPT, body: BODY, tags: TAGS,
      status: 'draft', category: 'Heritage & Traditions', kind: 'community',
      authorId: author.id, cityId: null, country: 'TR', coverImage: null,
    },
    select: { id: true },
  })
  console.log(`✓ drafted ${post.id}`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
