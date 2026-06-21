import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'

const getHandbookArticles = unstable_cache(
  async () => prisma.post.findMany({
    where:   { kind: 'handbook', status: 'published' },
    orderBy: { publishedAt: 'desc' },
    select:  { id: true, slug: true, title: true, excerpt: true, category: true, publishedAt: true, author: { select: { name: true } } },
  }),
  ['handbook-articles'],
  { revalidate: 300, tags: ['handbook'] },
)

export const metadata = {
  title: 'The Istanbul Handbook — Smileys Community',
  description: 'Survive and thrive in Istanbul. Residence permits, banking, schools, doctors, transport — the canonical answers, written by members who actually lived through them.',
  openGraph: {
    title: 'The Istanbul Handbook — Smileys Community',
    description: 'The expat survival KB written by members who actually lived it. Residence permits, banking, schools, doctors, transport.',
    url: 'https://smileyscommunity.com/handbook',
  },
}

// Five fixed categories — the same vocabulary used in the admin form
// and stored as Post.category. Order and emoji live here (not in the
// DB) so a re-theme doesn't need a migration. Palette is uniform
// across cards — the emoji + label carry differentiation. Previous
// per-card gradient (blue/green/amber/rose/violet) made the grid
// visually busy without aiding recognition more than the emoji
// already does.
const CARD_CLS = 'from-gray-50 to-white border-gray-200 text-gray-900'
const CATEGORIES = [
  { key: 'Bureaucracy',     emoji: '📋', label: 'Bureaucracy & Legal',  tagline: 'Permits, taxes, paperwork' },
  { key: 'Money',           emoji: '💳', label: 'Money',                tagline: 'Banking, FX, inflation' },
  { key: 'Daily Life',      emoji: '🏠', label: 'Daily Life',           tagline: 'Apartments, doctors, utilities' },
  { key: 'Family',          emoji: '👨‍👩‍👧', label: 'Family',                  tagline: 'Schools, kreş, kids\' healthcare' },
  { key: 'Getting Around',  emoji: '🚇', label: 'Getting Around',       tagline: 'Transport, driving, flights' },
] as const
const VALID_CATEGORIES = new Set(CATEGORIES.map(c => c.key as string))

function formatDate(d: Date | string | null) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default async function HandbookPage() {
  const articles = await getHandbookArticles()

  // Group articles by category so each card can show a count + the
  // freshest article underneath as a teaser. Dev-only: warn if an
  // article's category doesn't match one of the 5 known keys — a
  // typo in the admin form would otherwise hide the article from
  // this index silently (the category card it'd belong to doesn't
  // exist, so the article never gets rendered).
  const byCategory: Record<string, typeof articles> = {}
  for (const a of articles) {
    if (!VALID_CATEGORIES.has(a.category)) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[handbook] article "${a.slug}" has unknown category "${a.category}" — won't appear on the index. Fix the admin form value or add the category to CATEGORIES.`)
      }
      continue
    }
    if (!byCategory[a.category]) byCategory[a.category] = []
    byCategory[a.category].push(a)
  }
  const featured = articles[0] ?? null

  return (
    <main>
      {/* Hero — warmer than /pro, signalling "useful + welcoming"
          rather than "exclusive". The handbook is for everyone. */}
      <section className="bg-gradient-to-br from-amber-50 via-orange-50 to-white border-b border-amber-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-amber-200 text-amber-700 text-[11px] font-bold tracking-widest uppercase mb-6">
            📖 The Handbook
          </div>
          <h1 className="text-4xl sm:text-6xl font-extrabold text-gray-900 tracking-tight leading-[1.05] mb-5">
            Living in Istanbul,<br /> <span className="text-amber-600">decoded.</span>
          </h1>
          <p className="text-base sm:text-lg text-gray-600 max-w-xl leading-relaxed">
            Residence permits, bank accounts, schools, doctors, transport — the canonical answers,
            written by Smileys members who actually lived through them.
          </p>
        </div>
      </section>

      {/* Categories */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-6">Browse by topic</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CATEGORIES.map(cat => {
              const items = byCategory[cat.key] ?? []
              return (
                <Link key={cat.key} href={`/handbook/category/${encodeURIComponent(cat.key)}`}
                  className={`block bg-gradient-to-br ${CARD_CLS} border rounded-2xl p-6 hover:-translate-y-0.5 hover:shadow-md transition-all group`}>
                  <div className="flex items-start justify-between mb-3">
                    <div aria-hidden="true" className="text-3xl">{cat.emoji}</div>
                    <span className="text-xs font-bold opacity-70 tabular-nums">
                      {items.length} {items.length === 1 ? 'article' : 'articles'}
                    </span>
                  </div>
                  <h3 className="text-lg font-extrabold mb-1 leading-tight">{cat.label}</h3>
                  <p className="text-xs opacity-70 mb-4">{cat.tagline}</p>
                  {items[0] && (
                    <p className="text-xs font-semibold border-t border-current/10 pt-3 line-clamp-1 opacity-80 group-hover:opacity-100 group-hover:text-amber-700 transition-colors">
                      <span aria-hidden="true" className="inline-block group-hover:translate-x-0.5 transition-transform">→</span> {items[0].title}
                    </p>
                  )}
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      {/* Featured / latest — surfaced separately so a brand-new article
          gets discovery love beyond just sitting in its category bucket. */}
      {featured && (
        <section className="bg-gray-50 border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-6">Latest article</h2>
            <Link href={`/handbook/${featured.slug}`} className="block bg-white rounded-2xl border border-gray-200 p-7 hover:border-amber-300 hover:shadow-md transition-all group">
              <div className="flex items-center gap-2 mb-3 text-xs text-gray-600">
                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">{featured.category}</span>
                {featured.publishedAt && <span>· {formatDate(featured.publishedAt)}</span>}
                {featured.author?.name && <span>· by {featured.author.name.split(' ')[0]}</span>}
              </div>
              <h3 className="text-2xl font-extrabold text-gray-900 mb-2 group-hover:text-amber-600 transition-colors leading-tight">
                {featured.title}
              </h3>
              {featured.excerpt && (
                <p className="text-sm text-gray-600 leading-relaxed line-clamp-2">{featured.excerpt}</p>
              )}
              <p className="text-sm text-amber-600 font-bold mt-4 group-hover:translate-x-0.5 transition-transform">Read it →</p>
            </Link>
          </div>
        </section>
      )}

      {/* Cross-link to /guide — Handbook is for sit-and-read deep
          dives; the City Guide is the scannable "which app/service
          do I use for X" companion. Placed AFTER Featured so it reads
          as a "want the scannable version?" follow-up instead of an
          interruption between Categories and Featured. */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Link href="/guide"
            className="block bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-2xl px-5 py-4 transition-colors group">
            <div className="flex items-center gap-4">
              <div className="text-2xl shrink-0">🗺️</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900">Need a quick link, not a deep read?</p>
                <p className="text-xs text-gray-600 mt-0.5">The Istanbul Guide is the scannable companion — apps to install, services to bookmark, links members trust.</p>
              </div>
              <span className="text-sm font-bold text-gray-700 shrink-0 group-hover:translate-x-0.5 transition-transform">→</span>
            </div>
          </Link>
        </div>
      </section>

      {articles.length === 0 ? (
        /* Empty-DB bottom — folds the contributor pitch into the
           empty-state so the page doesn't end with two stacked CTAs
           saying related things (the prior shape rendered the
           "landing soon" panel AND the recurring pitch back-to-back). */
        <section className="bg-white">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
            <div aria-hidden="true" className="text-5xl mb-4">📝</div>
            <h2 className="text-xl font-extrabold text-gray-900 mb-2">First articles landing soon</h2>
            <p className="text-sm text-gray-600 max-w-md mx-auto mb-6">
              The Handbook is being seeded with the first 20 essential articles. Lived through something the rest of us are about to face? Write the one you wish had existed when you arrived — members who contribute get a permanent <span className="font-semibold text-amber-600">Contributor badge</span>.
            </p>
            <Link href="/contact?topic=handbook" className="inline-block px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors">
              Pitch a topic →
            </Link>
          </div>
        </section>
      ) : (
        /* Recurring contributor pitch — shown only when the Handbook
           has articles. On empty DB the combined empty-state above
           already carries the contribute CTA. */
        <section className="bg-white">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center border-t border-gray-100">
            <h2 className="text-xl font-extrabold text-gray-900 mb-2">Lived through something the rest of us are about to face?</h2>
            <p className="text-sm text-gray-600 max-w-md mx-auto mb-6">
              Members who write a Handbook article get a permanent <span className="font-semibold text-amber-600">Contributor badge</span> and our deep gratitude. DM us the topic and we'll edit it together.
            </p>
            <Link href="/contact?topic=handbook" className="inline-block px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors">
              Pitch a topic →
            </Link>
          </div>
        </section>
      )}
    </main>
  )
}
