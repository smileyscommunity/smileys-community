import Link from 'next/link'
import { notFound } from 'next/navigation'
import { postCityScope } from '@/lib/postScope'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId, getCityConfig } from '@/lib/city'
import { canonicalCategory, categoryMeta, storedKeysFor } from '@/lib/handbook-categories'
import { articleCover } from '@/lib/articleCover'
import { storyBylines } from '@/lib/storyByline'

// Queried by every stored key that maps to this canonical category, so legacy
// rows still filed under the old vocabulary appear here rather than vanishing
// from the IA until someone re-saves them.
// Same city rule as the Handbook index, from the one definition in
// lib/postScope: this city, its country's national articles, and global ones.
const getHandbookCategory = unstable_cache(
  async (storedKeys: string[], cityId: string, country: string | null) => prisma.post.findMany({
    where:   { kind: 'handbook', status: 'published', category: { in: storedKeys }, ...postCityScope(cityId, country) },
    orderBy: { publishedAt: 'desc' },
    select:  {
      id: true, slug: true, title: true, excerpt: true, coverImage: true, body: true, category: true, publishedAt: true,
      // Projected per viewer after the cache — see the index.
      author: { select: {
        id: true, name: true, color: true, profilePhoto: true,
        profileVisibility: true, status: true, hiddenFromMembers: true,
      } },
    },
  }),
  ['handbook-category'],
  { revalidate: 300, tags: ['handbook'] },
)

// In the viewer city's day — the server is UTC, so a 00:30 publish read as
// the day before.
function formatDate(d: Date | string | null, timeZone: string) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone })
}

// Next hands the segment already decoded; decoding it again threw a URIError
// on a stray percent (`%E0`) and 500'd the page instead of 404ing. Keep the
// decode for the legacy indexed URLs that carry an encoded space, but never
// let it throw.
function categoryKeyFrom(param: string): string {
  try { return decodeURIComponent(param) } catch { return param }
}

type Params = { params: Promise<{ key: string }> }

export async function generateMetadata({ params }: Params) {
  const { key } = await params
  const cat = categoryMeta(categoryKeyFrom(key))
  if (!cat) return { title: 'Handbook — Smileys Community' }
  // Names the viewer's city. A crawler carries no cookie, so it resolves to the
  // default city and keeps the indexed "… — Istanbul Handbook" titles intact.
  const city = await getCityConfig(await resolveCityId(await getSession()))
  return {
    title:       `${cat.label} — ${city.name} Handbook | Smileys Community`,
    description: cat.tagline,
  }
}

export default async function HandbookCategoryPage({ params }: Params) {
  const { key } = await params
  const decoded = categoryKeyFrom(key)
  // Legacy /handbook/category/Bureaucracy URLs are indexed, so they resolve to
  // the canonical category rather than 404ing.
  const canonical = canonicalCategory(decoded)
  const cat = canonical ? categoryMeta(canonical) : null
  if (!canonical || !cat) notFound()

  const session  = await getSession()
  const cityId   = await resolveCityId(session)
  const cfg      = await getCityConfig(cityId)
  const articles = await getHandbookCategory(storedKeysFor(canonical), cityId, cfg.country ?? null)
  const byline   = await storyBylines(session, articles.map(a => a.author))

  return (
    <main className="bg-gray-50 min-h-screen">
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12"><div className="max-w-3xl">
          <Link href="/handbook" className="text-xs text-amber-600 font-semibold hover:underline">← The Handbook</Link>
          <div className="flex items-center gap-3 mt-4 mb-3">
            <span className="text-4xl">{cat.emoji}</span>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 leading-tight">{cat.label}</h1>
          </div>
          <p className="text-sm text-gray-600 max-w-xl leading-relaxed">{cat.tagline}</p>
        </div></div>
      </section>

      <section>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10"><div className="max-w-3xl space-y-3">
          {articles.length === 0 ? (
            <div className="text-center py-16 text-sm text-gray-600 bg-white rounded-2xl border border-dashed border-gray-200">
              Nothing in {cat.label} for {cfg.name} yet.
            </div>
          ) : articles.map(a => {
            // Cover → first inline body image (own uploads only, the rule the
            // article page and og:image follow — a private copy of this regex
            // here took any host) → the category banner. One helper.
            const cover = articleCover({ coverImage: a.coverImage, body: a.body, category: canonical })
            return (
              <Link key={a.id} href={`/handbook/${a.slug}`}
                className="block bg-white rounded-2xl border border-gray-200 overflow-hidden hover:border-amber-300 hover:shadow-sm hover:-translate-y-0.5 transition-all group">
                <div className={cover ? 'sm:flex sm:items-stretch' : ''}>
                  {cover && (
                    <div className="w-full sm:w-56 shrink-0 bg-gray-100 overflow-hidden aspect-[3/2] sm:aspect-auto">
                      <img src={cover} alt=""
                        className="w-full h-full object-cover" loading="lazy" decoding="async" />
                    </div>
                  )}
                  <div className="p-6 min-w-0">
                    <div className="flex items-center gap-2 mb-2 text-xs text-gray-600">
                      {a.publishedAt && <span>{formatDate(a.publishedAt, cfg.timezone)}</span>}
                      <span>· by {byline(a.author).name}</span>
                    </div>
                    <h2 className="text-lg sm:text-xl font-extrabold text-gray-900 group-hover:text-amber-600 transition-colors leading-tight">
                      {a.title}
                    </h2>
                    {a.excerpt && (
                      <p className="text-sm text-gray-600 mt-2 leading-relaxed line-clamp-2">{a.excerpt}</p>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div></div>
      </section>
    </main>
  )
}
