import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { resolveImageUrl } from '@/lib/data'
import { categoryHero } from '@/lib/handbook-categories'
import { APP_URL } from '@/lib/env'

// Prefer explicit coverImage, then the first inline <img> in the body (most
// articles paste a hero photo at the top via the rich-text editor rather than
// setting the separate cover field), then the category banner as a last resort.
const FIRST_BODY_IMG_RE = /<img\b[^>]*\bsrc=["']([^"']+)["']/i
function articleCover(a: { coverImage: string | null; body: string; category: string }): string | null {
  if (a.coverImage) return resolveImageUrl(a.coverImage)
  const inline = a.body.match(FIRST_BODY_IMG_RE)?.[1]
  if (inline) return resolveImageUrl(inline)
  return categoryHero(a.category)?.src ?? null
}

const getHandbookArticles = unstable_cache(
  async () => prisma.post.findMany({
    where:   { kind: 'handbook', status: 'published' },
    orderBy: { publishedAt: 'desc' },
    select:  { id: true, slug: true, title: true, excerpt: true, coverImage: true, body: true, category: true, publishedAt: true, author: { select: { name: true } } },
  }),
  ['handbook-articles'],
  { revalidate: 300, tags: ['handbook'] },
)

// Fixed-size cover (1200×800) so we can assert real dimensions, unlike the
// variable-aspect article photos. Served from public/ under the /app basePath.
const HANDBOOK_OG_IMAGE = `${APP_URL}/images/handbook-cover.jpg`
const HANDBOOK_OG_DESC  = 'The practical guide to living in Istanbul, written by Smileys members who actually lived it — residence permits, banking, schools, doctors, transport.'

export const metadata = {
  alternates: { canonical: '/app/handbook' },
  title: 'The Istanbul Handbook — Smileys Community',
  description: 'Survive and thrive in Istanbul. Residence permits, banking, schools, doctors, transport — the canonical answers, written by members who actually lived through them.',
  openGraph: {
    title: 'The Istanbul Handbook — Smileys Community',
    description: HANDBOOK_OG_DESC,
    // Include the /app basePath — the bare /handbook path 301-redirects, which
    // some crawlers won't follow for the canonical.
    url: `${APP_URL}/handbook`,
    siteName: 'Smileys Community',
    type: 'website',
    images: [{ url: HANDBOOK_OG_IMAGE, secureUrl: HANDBOOK_OG_IMAGE, width: 1200, height: 800, alt: 'The Istanbul Handbook — Smileys Community' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Istanbul Handbook — Smileys Community',
    description: HANDBOOK_OG_DESC,
    images: [HANDBOOK_OG_IMAGE],
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
  // Newest 5 articles, all rendered in a single uniform style so no piece
  // gets more visual weight than the others.
  const latest = articles.slice(0, 5)

  return (
    <main>
      {/* Hero — warmer than /pro, signalling "useful + welcoming"
          rather than "exclusive". The handbook is for everyone. */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-6">
          <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">
            📖 The Handbook
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">
            Living in Istanbul, <span className="text-amber-600">decoded.</span>
          </h1>
          <p className="text-base text-gray-600 mt-1 max-w-xl">
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

      {/* Latest — up to 5 newest articles, all rendered in the same
          flanked-card style so none is visually privileged. */}
      {latest.length > 0 && (
        <section className="bg-gray-50 border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-6">
              {latest.length > 1 ? 'Latest articles' : 'Latest article'}
            </h2>
            <div className="space-y-4">
              {latest.map(a => {
                const cover = articleCover(a)
                return (
                  <Link key={a.id} href={`/handbook/${a.slug}`}
                    className="block bg-white rounded-2xl border border-gray-200 hover:border-amber-300 hover:shadow-md transition-all group overflow-hidden">
                    <div className={cover ? 'sm:flex sm:items-stretch' : ''}>
                      {cover && (
                        <div className="w-full sm:w-56 shrink-0 bg-gray-100 overflow-hidden aspect-[3/2] sm:aspect-auto">
                          <img src={cover} alt=""
                            className="w-full h-full object-cover" loading="lazy" decoding="async" />
                        </div>
                      )}
                      <div className="p-6 min-w-0">
                        <div className="flex items-center gap-2 mb-2 text-xs text-gray-600">
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">{a.category}</span>
                          {a.publishedAt && <span>· {formatDate(a.publishedAt)}</span>}
                          {a.author?.name && <span>· by {a.author.name.split(' ')[0]}</span>}
                        </div>
                        <h3 className="text-lg sm:text-xl font-extrabold text-gray-900 group-hover:text-amber-600 transition-colors leading-tight">
                          {a.title}
                        </h3>
                        {a.excerpt && (
                          <p className="text-sm text-gray-600 mt-2 leading-relaxed line-clamp-2">{a.excerpt}</p>
                        )}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
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
