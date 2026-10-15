// Draft: "Love Without Borders" Part 1 (community post, Expats category, global).
//
// Saved as a DRAFT only. Publishing (and the one-time "new article" bell) goes
// through the normal admin publish path once Nate has reviewed it, so
// notifiedAt is deliberately left null here. No cover image yet: the approved
// hero photo is attached afterwards (COVER=<uploaded path> with UPDATE_COVER=1).
//
// Global on purpose (cityId null, country null): the series is about people
// across cultures, not about one city. Category 'Expats' (the "Next in Expats"
// link will chain Part 2 once it exists).
//
// Reference check 2026-10-15 (Crossref): all three DOIs resolve. The Personal
// Relationships meta-analysis (vol 29 issue 1, March 2022; online Oct 2021)
// reviews 20 studies and its abstract reports no evidence that culturally
// different couples are less satisfied — which is the claim made in the body.
//
//   DRY_RUN=1 npx tsx --env-file=.env --env-file=.env.local scripts/draft-love-without-borders.ts
//
// Idempotent (skips if the slug exists).
import { prisma } from '@/lib/prisma'

const DRY_RUN = process.env.DRY_RUN === '1'
export const LWB_SLUG = 'love-without-borders-international-relationships'

const TITLE = 'Love Without Borders: When Two Cultures Fall in Love'

// Doubles as the meta / OG description (app/posts/[slug] uses the excerpt).
const EXCERPT =
  'What happens when two people from different cultures fall in love? Discover the attraction, surprises, and realities of international relationships.'

const EXT = 'target="_blank" rel="noopener noreferrer"'

const BODY = `<p>Different countries, different languages, different ways of seeing the world. What happens when two people from different cultures fall in love?</p>

<p>Falling in love doesn’t always follow the boundaries of nationality, language, or culture.</p>
<p>Maybe you met while traveling. Perhaps you were studying abroad, working in another country, or attending a social event where you barely knew anyone.</p>
<p>One conversation led to another. You discovered shared interests, laughed at the same jokes, and found yourself wanting to spend more time together.</p>
<p>Somewhere along the way, you realized that the person you were falling for had grown up in a completely different world.</p>
<p>Welcome to international love.</p>

<h2>The Attraction of Someone Different</h2>
<p>There’s something fascinating about getting to know someone whose life experiences are different from your own.</p>
<p>They introduce you to music you’ve never heard, food you’ve never tasted, and traditions you’ve never experienced.</p>
<p>Even everyday conversations become interesting. You compare childhood memories, family habits, school experiences, and the little things people take for granted in their own countries.</p>
<p>Sometimes the differences are amusing.</p>
<p>You discover that what you consider a perfectly normal breakfast seems completely strange to your partner. Or that arriving fifteen minutes late means nothing in one person’s world and is practically a declaration of war in the other’s.</p>
<p>But the attraction isn’t necessarily about cultural differences.</p>
<p>Often, it’s about discovering how much you have in common despite them.</p>
<p>Two people can grow up thousands of kilometers apart and still share the same sense of humor, values, dreams, and outlook on life.</p>
<p>And that discovery can be surprisingly powerful.</p>

<h2>When the Honeymoon Meets Reality</h2>
<p>In the beginning, cultural differences can feel charming.</p>
<p>An unfamiliar expression is adorable. A misunderstanding becomes a funny story. Even struggling to communicate can seem romantic.</p>
<p>But relationships eventually move beyond first dates and exciting discoveries.</p>
<p>You begin to notice that your partner doesn’t always react the way you expect.</p>
<p>Perhaps you grew up in a family where everyone speaks openly about their feelings, while your partner comes from a background where emotions are expressed more privately.</p>
<p>Maybe one of you considers spending time with family an essential weekly tradition, while the other values personal independence.</p>
<p>Neither approach is automatically right or wrong.</p>
<p>And not every difference comes from culture. Personality, upbringing, and individual experiences matter just as much as nationality.</p>
<p>The challenge begins when we assume that our way of doing things is the normal way.</p>
<p>That’s often when international relationships become more than a romantic adventure. They become an opportunity to question things we’ve believed our entire lives.</p>

<h2>Are We Really That Different?</h2>
<p>It’s easy to talk about cultural differences as if everyone from the same country thinks and behaves alike.</p>
<p>But they don’t.</p>
<p>Two people from Istanbul may have completely different ideas about relationships. Someone from New York might have more in common with a person from Tokyo than with their next-door neighbor.</p>
<p>Nationality can influence us, but it doesn’t define everything about us.</p>
<p>Interestingly, research challenges the assumption that relationships between people from different cultural backgrounds are inherently less satisfying.</p>
<p>A 2022 meta-analysis published in <em>Personal Relationships</em>, which examined 20 studies, found no overall evidence that culturally diverse couples reported lower relationship satisfaction than culturally similar couples (<a href="https://doi.org/10.1111/pere.12405" ${EXT}>see reference 1</a>).</p>
<p>Cultural differences may introduce challenges, but they don’t automatically determine whether a relationship succeeds.</p>
<p>This is particularly relevant in international communities, where people may have lived in several countries, speak multiple languages, and feel connected to more than one culture.</p>
<p>The person you’re dating may not fit the stereotypes associated with their passport at all.</p>
<p>And perhaps that’s one of the most interesting parts of international relationships: discovering the individual behind the cultural label.</p>

<h2>Love Is Not a Tourist Experience</h2>
<p>There’s a difference between falling in love with another person and falling in love with the idea of being with someone foreign.</p>
<p>An international relationship isn’t an extended vacation.</p>
<p>Your partner isn’t there to represent an entire country, explain every cultural tradition, or provide an exotic alternative to people from your own background.</p>
<p>They’re an individual, with ordinary habits, imperfections, ambitions, and frustrations.</p>
<p>The excitement of discovering another culture can bring two people together, but a lasting connection needs something deeper.</p>
<p>It needs genuine interest in who the other person is, not simply where they come from.</p>

<h2>A World That Becomes a Little Bigger</h2>
<p>For many people, one of the most rewarding aspects of an international relationship is discovering new ways of seeing the world.</p>
<p>You may begin to see your own country differently. Things you once considered universal suddenly become cultural habits rather than absolute truths.</p>
<p>You learn that there are many ways to celebrate, communicate, build friendships, and express affection.</p>
<p>You may even discover things about yourself that you never questioned before.</p>
<p>Of course, being in an international relationship doesn’t automatically make someone more tolerant, understanding, or open-minded.</p>
<p>But it can create opportunities to become those things.</p>
<p>And when both partners approach their differences with curiosity rather than judgment, those opportunities can be meaningful.</p>

<h2>Where Connections Begin</h2>
<p>At Smileys Community, people from different countries and backgrounds meet through social gatherings, language exchanges, and shared activities.</p>
<p>Some are expats building a new life abroad. Others are internationally minded locals, students, travelers, or people who have spent years moving between cultures.</p>
<p>They come to make friends, practice languages, share experiences, and find a sense of belonging.</p>
<p>Occasionally, friendships turn into something more.</p>
<p>But whether a connection becomes romantic or remains a friendship, meeting people from different backgrounds can change the way we understand one another.</p>
<p>That’s part of what makes an international community special.</p>
<p>Love without borders isn’t necessarily about finding someone from another country.</p>
<p>It’s about recognizing that meaningful human connections don’t have to be limited by nationality, language, or geography.</p>
<p>And sometimes, the person who understands you best comes from a place you’ve never even visited.</p>

<h2>Let’s Hear Your Story</h2>
<p>Have you ever been in a relationship with someone from another country?</p>
<p>What attracted you to each other? What surprised you most about your cultural differences?</p>
<p>We’d love to hear your experiences.</p>

<h2>Coming Next: Lost in Translation</h2>
<p>When couples don’t share the same native language, even the simplest conversations can become complicated. From misunderstood jokes to emotional arguments, we’ll explore what happens when love and language don’t always speak the same way.</p>

<h2>Research &amp; Further Reading</h2>
<ol>
<li><a href="https://doi.org/10.1111/pere.12405" ${EXT}>Cultural diversity within couples: Risk or chance? A meta-analytic review of relationship satisfaction</a> — <em>Personal Relationships</em> (2022)</li>
<li><a href="https://doi.org/10.1016/j.ijintrel.2024.102114" ${EXT}>Overcoming barriers to intercultural communication in romantic love relationships across WEIRD and non-WEIRD cultural regions</a> — <em>International Journal of Intercultural Relations</em> (2025)</li>
<li><a href="https://doi.org/10.1080/14681994.2021.1931095" ${EXT}>“More Alike than Different”: a qualitative exploration of the relational experiences of multicultural couples in Turkey</a> — <em>Sexual and Relationship Therapy</em> (2021)</li>
</ol>`

async function main() {
  const existing = await prisma.post.findUnique({ where: { slug: LWB_SLUG }, select: { id: true, status: true } })
  if (existing && process.env.UPDATE_BODY === '1' && existing.status === 'draft') {
    console.log(`→ updating body of draft ${existing.id}`)
    if (DRY_RUN) { console.log('  DRY RUN — nothing written'); return }
    await prisma.post.updateMany({ where: { id: existing.id, status: 'draft' }, data: { body: BODY } })
    console.log('✓ body updated'); return
  }
  if (existing) { console.log(`✓ already exists (${existing.status}) — nothing to do`); return }

  const author = await prisma.user.findFirst({
    where:  { name: 'Nate G.', role: { in: ['admin', 'moderator'] } },
    select: { id: true, name: true },
  })
  if (!author) throw new Error('Author "Nate G." not found')

  console.log(`→ draft "${TITLE}"`)
  console.log(`  slug     /posts/${LWB_SLUG}`)
  console.log(`  category Expats · global (no city, no country) · author ${author.name}`)
  console.log(`  excerpt  ${EXCERPT.length} chars · body ${BODY.length} chars`)
  if (DRY_RUN) { console.log('\n  DRY RUN — nothing written'); return }

  const post = await prisma.post.create({
    data: {
      title: TITLE, slug: LWB_SLUG, excerpt: EXCERPT, body: BODY,
      status: 'draft', category: 'Expats', kind: 'community',
      authorId: author.id, cityId: null, country: null, coverImage: null,
    },
    select: { id: true },
  })
  console.log(`✓ drafted ${post.id}`)
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
