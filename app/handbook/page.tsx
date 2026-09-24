import Link from 'next/link'
import { existsSync } from 'fs'
import { join } from 'path'
import Image from 'next/image'
import HandbookSearch from '@/components/HandbookSearch'
import ExploreMore from '@/components/ExploreMore'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { DEFAULT_CITY_SLUG } from '@/lib/city'
import { DEFAULT_TZ } from '@/lib/cityTime'
import { resolveCityForPage, type CitySearch } from '@/lib/cityPageParam'
import { shareCover } from '@/lib/shareCover'
import { postCityScope } from '@/lib/postScope'
import { articleCover } from '@/lib/articleCover'
import { getSession } from '@/lib/session'
import { storyBylines } from '@/lib/storyByline'
import { canonicalCategory, categoryMeta, CATEGORY_KEYS, HANDBOOK_CATEGORIES } from '@/lib/handbook-categories'
import { reviewLabel, readingTime } from '@/lib/handbook-review'
import type { HandbookSearchItem } from '@/lib/handbook-search'
import { APP_URL } from '@/lib/env'
import { populatedStages } from '@/lib/relocation'
import { hasQuickReference } from '@/lib/quickReference'
import { resolveImageUrl } from '@/lib/data'

// Card covers come from lib/articleCover: explicit cover, else the first
// inline body image — OWN UPLOADS ONLY — else the category banner. A private
// copy of that regex here took any host, so an external <img> the article
// page strips was still fetched by every visitor to this index.

// Scoped to the viewer's city by the shared rule in lib/postScope: this
// city's own articles, its COUNTRY's national ones (residence permits, tax
// numbers), and the genuinely global ones. City and country are both part of
// the cache key, not captured from the request inside it: one shared cache
// entry per city, never a city's articles served to another.
const getHandbookArticles = unstable_cache(
  async (cityId: string, country: string | null) => prisma.post.findMany({
    where:   { kind: 'handbook', status: 'published', ...postCityScope(cityId, country) },
    orderBy: { publishedAt: 'desc' },
    select:  {
      id: true, slug: true, title: true, excerpt: true, body: true, coverImage: true, category: true, cityId: true,
      publishedAt: true, lastReviewedAt: true, reviewIntervalDays: true, tags: true,
      // The privacy columns ride along so the byline can be projected for
      // this viewer AFTER the cache (lib/storyByline) — a card must not say
      // "by Nate" for an author the article itself calls a Smileys member.
      author: { select: {
        id: true, name: true, color: true, profilePhoto: true,
        profileVisibility: true, status: true, hiddenFromMembers: true,
      } },
    },
  }),
  ['handbook-articles'],
  { revalidate: 300, tags: ['handbook'] },
)

// The share picture: public/images/handbook-cover-<city slug>.jpg when the
// city has one (Istanbul's is the book literally titled "Istanbul Handbook"),
// else its hero photo. Rules and size limit in lib/shareCover.
// The Handbook names the city you're reading it in. The DEFAULT city keeps its
// exact indexed strings — this page ranks for "Istanbul handbook"/"understand
// Istanbul", and rewording a title Google already has is a real loss for no
// gain. Every other city gets the same sentence with its own name. The article
// list itself is scoped the same way (see getHandbookArticles): global articles
// everywhere, city-local ones only at home.
//
// Which city: ?city= when the URL carries one, else the session
// (lib/cityPageParam, the rule /neighborhoods set). A link-preview crawler has
// neither session nor cookie, so without the param every share of /handbook
// previewed as Istanbul's — title, description and the cover above — whatever
// city the sharer had on screen. The page redirects the bare URL to the
// explicit one for every city but the default, so the address bar itself is
// the shareable link.
export async function generateMetadata({ searchParams }: { searchParams?: Promise<CitySearch> }): Promise<Metadata> {
  const { city } = await resolveCityForPage(searchParams)
  const { name } = city
  const isDefault    = city.slug === DEFAULT_CITY_SLUG
  const canonicalUrl = isDefault ? `${APP_URL}/handbook` : `${APP_URL}/handbook?city=${city.slug}`
  const title = `The ${name} Handbook — Understand ${name}`
  // The default city's description names its topics — it has them. Another
  // city's promises only what every city's handbook has: answers written by
  // members who lived there. Tbilisi's was promising residence permits and
  // banking above an empty index.
  const desc  = isDefault
    ? 'Understand Istanbul. Practical answers for living, moving and navigating life in Istanbul — residence permits, banking, healthcare, transport — written by Smileys members who actually lived it.'
    : `Understand ${name}. Practical answers for living, moving and navigating life in ${name} — written by Smileys members who actually lived it.`
  const alt = `The ${name} Handbook — Smileys Community`

  const image = shareCover('handbook', city, alt)

  return {
    // Each city's variant is its own canonical; a shared bare URL would
    // otherwise point every city's handbook at Istanbul's.
    alternates: { canonical: canonicalUrl },
    title: `${title} | Smileys Community`,
    description: desc,
    openGraph: {
      title,
      description: desc,
      // Include the /app basePath — the bare /handbook path 301-redirects, which
      // some crawlers won't follow for the canonical.
      url: canonicalUrl,
      siteName: 'Smileys Community',
      type: 'website',
      images: [image],
    },
    twitter: {
      card: 'summary_large_image' as const,
      title,
      description: desc,
      images: [image.url],
    },
  }
}

// "Start here" — the questions people actually arrive with, each pointing at
// its canonical article (brief §9: cards link to canonical Handbook content,
// never to duplicated summaries). Curated by slug; a card whose article is
// missing or unpublished simply doesn't render, so a slug rename can't leave
// a dead card on the most-trafficked section of the page.
//
// DEFAULT CITY ONLY, and by hand: this is an Istanbul reading list — an
// Istanbulkart card has no business on another city's handbook, and most of
// these articles are still filed as global (cityId null) so the query alone
// won't hold them back. Per-city "start here" curation is the follow-up; until
// then a second city gets the categories and Latest instead of a wrong shelf.
const START_HERE: { slug: string; emoji: string; label: string }[] = [
  // In the order a newcomer meets them: can I come, how do I get in, the
  // first-week setup, then the longer admin — with the two "something went
  // wrong" guides last. Slugs that don't resolve for the viewer's city drop
  // out (see startHere below), so a renamed article can't leave a dead card.
  { slug: 'entering-turkiye-visa-free-stays-e-visas-and-the-90-180-rule', emoji: '🛂', label: 'Check your visa and stay limit' },
  { slug: 'arriving-in-istanbul-getting-from-ist-and-sabiha-gokcen-into-the-city', emoji: '✈️', label: 'Get in from the airport' },
  { slug: 'sim-card-and-home-internet-in-turkiye',          emoji: '📱', label: 'Get a SIM and home internet' },
  { slug: 'istanbulkart-mastery',                          emoji: '🚇', label: 'Get around with Istanbulkart' },
  { slug: 'opening-turkish-bank-account',                  emoji: '💳', label: 'Open a bank account' },
  { slug: 'residence-permit-first-application',            emoji: '🏠', label: 'Get your residence permit' },
  { slug: 'working-remotely-from-turkiye-digital-nomad-visa-work-permissions-tax-social', emoji: '💻', label: 'Work remotely, legally' },
  { slug: 'healthcare-in-istanbul-how-the-system-works',   emoji: '🏥', label: 'Use the healthcare system' },
  { slug: 'daily-life-in-istanbul-the-little-things-that-make-a-big-difference',       emoji: '🧺', label: 'Set up daily life' },
  { slug: 'family-life-in-istanbul-raising-children-with-confidence',                  emoji: '👨‍👩‍👧', label: 'Move with children' },
  { slug: 'emergency-numbers-in-turkiye-call-112-and-other-numbers-worth-saving',     emoji: '🆘', label: 'Know the emergency numbers' },
  { slug: 'scams-tourist-traps-in-t-rkiye-how-to-stay-safe-without-becoming-paranoid', emoji: '🛡️', label: 'Avoid scams and stay safe' },
]

// A review is a staff act, so it reads in the default city's day — the same
// calendar reviewLabel() uses for the article page and the search results.
// (The server is UTC; without a zone a review stamped at 00:30 Istanbul read
// as the day before, and a viewer-city zone made the card and the article
// disagree by a day for cities off Istanbul's offset.)
function formatReviewedShort(d: Date | string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: DEFAULT_TZ })
}


export default async function HandbookPage({ searchParams }: { searchParams?: Promise<CitySearch> }) {
  const { city: cfg, cityId, pinned } = await resolveCityForPage(searchParams)
  // Put the city in the URL for anyone not on the default city, so the address
  // bar they copy is a link that survives being shared. Guarded on `pinned` so
  // this can't loop, and skipped for the default city to leave its established
  // bare URL (and its search ranking) alone.
  if (!pinned && cfg.slug !== DEFAULT_CITY_SLUG) redirect(`/handbook?city=${cfg.slug}`)

  const city = { id: cityId, country: cfg.country ?? null, name: cfg.name, isDefault: cfg.slug === DEFAULT_CITY_SLUG }
  const articles = await getHandbookArticles(city.id, city.country)
  const byline   = await storyBylines(await getSession(), articles.map(a => a.author))

  // Group by CANONICAL category so legacy-keyed rows land in the new IA
  // without a data migration. Dev-only: warn when an article's category
  // resolves to nothing — a typo in the admin form would otherwise hide the
  // article from this index silently.
  const byCategory: Record<string, typeof articles> = {}
  for (const a of articles) {
    const key = canonicalCategory(a.category)
    if (!key) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[handbook] article "${a.slug}" has unknown category "${a.category}" — won't appear on the index. Fix the admin form value or add the category to HANDBOOK_CATEGORIES.`)
      }
      continue
    }
    if (!byCategory[key]) byCategory[key] = []
    byCategory[key].push(a)
  }

  // Progressive reveal — render categories in IA order, but only the
  // populated ones. The full 10-category IA exists in code so articles have
  // somewhere to land the moment they're written, but empty shelves on the
  // page would read as abandoned.
  const visibleCategories = CATEGORY_KEYS
    .filter(key => (byCategory[key]?.length ?? 0) > 0)
    .map(key => ({ key, ...HANDBOOK_CATEGORIES[key] }))

  // Per-article derived bits, computed once and reused by search + sections.
  const bySlug = new Map(articles.map(a => [a.slug, a]))
  const enriched = articles.map(a => {
    const meta   = categoryMeta(a.category)
    const review = reviewLabel({ category: canonicalCategory(a.category) ?? a.category, lastReviewedAt: a.lastReviewedAt, reviewIntervalDays: a.reviewIntervalDays })
    return {
      slug:     a.slug,
      title:    a.title,
      excerpt:  a.excerpt ?? '',
      category: meta?.label ?? a.category,
      emoji:    meta?.emoji ?? '📖',
      reviewed: review?.text ?? null,
      minutes:  readingTime(a.body),
      tags:     a.tags,
    } satisfies HandbookSearchItem
  })
  // Whether a reviewed article is past its interval — the chip below must
  // not stay green on a review that has lapsed while the article page says
  // "⏳" for the same state.
  const staleBySlug = new Map(articles.map(a => [a.slug,
    reviewLabel({ category: canonicalCategory(a.category) ?? a.category, lastReviewedAt: a.lastReviewedAt, reviewIntervalDays: a.reviewIntervalDays })?.stale ?? false,
  ]))
  const enrichedBySlug = new Map(enriched.map(e => [e.slug, e]))

  const startHere = (city.isDefault ? START_HERE : [])
    .filter(c => bySlug.has(c.slug))
    .map(c => ({ ...c, article: enrichedBySlug.get(c.slug)!, cover: articleCover(bySlug.get(c.slug)!) }))

  // Life-stage entry points (lib/relocation): the same articles, read by
  // where the reader is in a move. Only stages this city can fill are
  // offered, so no card opens onto an empty list.
  const stages   = populatedStages(articles, cityId)
  const stageQs  = city.isDefault ? '' : `?city=${cfg.slug}`

  // The header photo: this city's own Handbook cover when it has one (the
  // same file its share image uses — lib/shareCover), else the city's hero
  // photo, else none. Never another city's picture.
  const ownCover  = `handbook-cover-${cfg.slug}.jpg`
  const heroImage = existsSync(join(process.cwd(), 'public', 'images', ownCover))
    ? { src: `/app/images/${ownCover}`, alt: `A "${city.name} Handbook" on a café table, with the city behind it` }
    : cfg.heroImage ? { src: resolveImageUrl(cfg.heroImage), alt: `${city.name}` } : null
  const showQuickRef = city.isDefault && hasQuickReference()

  // Latest — newest 5, rendered as flanked image cards. Each card carries a
  // review chip when (and only when) the article has a real lastReviewedAt
  // (brief §38's maintenance signal, folded into the list rather than a
  // separate text strip repeating the same articles; §14: never a fake date).
  const latest = articles.slice(0, 5)

  return (
    <main>
      {/* Hero + search share one band. Search stays the page's primary
          action (brief §7/§41): on desktop the photo sits beside the title
          and search rather than above them, and on phones it's a short strip
          that leaves the search box inside the first screen. */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 lg:pt-10 pb-10">
          <div className={heroImage ? 'grid lg:grid-cols-[1fr_minmax(0,460px)] gap-8 lg:gap-12 items-center' : ''}>
            {heroImage && (
              <div className="relative aspect-[3/1] lg:aspect-[3/2] rounded-2xl overflow-hidden shadow-sm lg:order-2">
                <Image src={heroImage.src} alt={heroImage.alt} fill priority
                  sizes="(max-width: 1023px) calc(100vw - 32px), 460px" className="object-cover" />
              </div>
            )}
            <div className="lg:order-1">
              <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">
                📖 The {city.name} Handbook
              </span>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">
                Understand <span className="text-amber-600">{city.name}.</span>
              </h1>
              <p className="text-base text-gray-600 mt-1 max-w-xl">
                Practical answers for living, moving and navigating life in {city.name} —
                written by Smileys members who actually lived it.
              </p>
              <div className="max-w-2xl mt-6">
                <HandbookSearch items={enriched} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Start here — the high-value questions, each linking straight to its
          canonical article. */}
      {startHere.length > 0 && (
        <section className="bg-gray-50 border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-6">Start here</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {startHere.map(c => (
                <Link key={c.slug} href={`/handbook/${c.slug}`}
                  className="bg-white border border-gray-200 rounded-2xl overflow-hidden hover:border-amber-300 hover:shadow-md hover:-translate-y-0.5 transition-all group flex flex-col">
                  {/* The article's own cover (lib/articleCover — own uploads
                      only, else its category banner); the emoji stays as the
                      fallback for an article with neither. */}
                  {c.cover ? (
                    <div className="aspect-[16/9] bg-gray-100 overflow-hidden">
                      <img src={c.cover} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    </div>
                  ) : (
                    <div aria-hidden="true" className="aspect-[16/9] bg-amber-50 flex items-center justify-center text-3xl">{c.emoji}</div>
                  )}
                  <div className="p-3.5">
                    <p className="text-sm font-extrabold text-gray-900 group-hover:text-amber-600 transition-colors leading-tight">
                      {c.label}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-1">{c.article.minutes} min read</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Where are you in your move? — life-stage entry points. */}
      {stages.length > 0 && (
        <section aria-labelledby="stages-title" className="bg-white border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <h2 id="stages-title" className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-6">Where are you in your move?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {stages.map(({ stage, articles: list }) => (
                <Link key={stage.key} href={`/handbook/stage/${stage.key}${stageQs}`}
                  className={`rounded-2xl border p-5 hover:shadow-md hover:-translate-y-0.5 transition-all group ${
                    stage.key === 'urgent' ? 'bg-red-50/60 border-red-100 hover:border-red-200' : 'bg-gray-50 border-gray-200 hover:border-amber-300'
                  }`}>
                  <div aria-hidden="true" className="text-2xl mb-2">{stage.emoji}</div>
                  <p className="text-sm font-extrabold text-gray-900 group-hover:text-amber-700 transition-colors leading-tight">{stage.label}</p>
                  <p className="text-xs text-gray-600 mt-1 leading-relaxed">{stage.blurb}</p>
                  <p className="text-[11px] font-semibold text-gray-500 mt-2">{list.length} {list.length === 1 ? 'guide' : 'guides'}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Explore the Handbook — only populated categories render. */}
      {visibleCategories.length > 0 && (
        <section className="bg-white border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-6">Explore the Handbook</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleCategories.map(cat => {
                const items = byCategory[cat.key] ?? []
                return (
                  <Link key={cat.key} href={`/handbook/category/${encodeURIComponent(cat.key)}`}
                    className="block bg-gradient-to-br from-gray-50 to-white border-gray-200 text-gray-900 border rounded-2xl overflow-hidden hover:-translate-y-0.5 hover:shadow-md transition-all group">
                    {/* The category's banner photo where one exists
                        (lib/handbook-categories), the same one its own page uses. */}
                    {cat.image && (
                      <div className="aspect-[5/2] bg-gray-100 overflow-hidden">
                        <img src={cat.image.src} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      </div>
                    )}
                    <div className="p-6">
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
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* Latest articles — the flanked image-card list. The green chip is
          the maintenance signal: it appears only on articles a human actually
          re-checked against sources, so its absence is information too. */}
      {latest.length > 0 && (
        <section className="bg-gray-50 border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-6">
              {latest.length > 1 ? 'Latest articles' : 'Latest article'}
            </h2>
            <div className="space-y-4">
              {latest.map(a => {
                const cover = articleCover(a)
                const e     = enrichedBySlug.get(a.slug)
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
                        <div className="flex items-center gap-2 mb-2 text-xs text-gray-600 flex-wrap">
                          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">{e?.category ?? a.category}</span>
                          <span>by {byline(a.author).name}</span>
                          <span>· {e?.minutes ?? 1} min read</span>
                          {a.lastReviewedAt && (
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold ${
                              staleBySlug.get(a.slug) ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              <span aria-hidden="true">{staleBySlug.get(a.slug) ? '⏳' : '✓'}</span> Reviewed {formatReviewedShort(a.lastReviewedAt)}
                            </span>
                          )}
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

      {/* Quick reference — a link, not the section itself. The link pack
          (apps, official sites, practical tips) filled 64% of this page after
          its own closing CTA; it lives at /handbook/quick-reference now.
          Default city only: data/city-guide.json is Istanbul's pack. */}
      {showQuickRef && (
        <section className="bg-white border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <Link href="/handbook/quick-reference"
              className="flex items-center gap-4 max-w-3xl rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4 hover:border-amber-300 hover:bg-amber-50/40 transition-colors group">
              <span aria-hidden="true" className="text-2xl shrink-0">🧭</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-extrabold text-gray-900 group-hover:text-amber-700">Quick reference</span>
                <span className="block text-xs text-gray-600 mt-0.5">Apps, official sites and practical links for day-to-day life in {city.name}.</span>
              </span>
              <span aria-hidden="true" className="text-sm font-bold text-gray-700 group-hover:translate-x-0.5 transition-transform">→</span>
            </Link>
          </div>
        </section>
      )}

      {/* Need something else? — the shared cross-link grid this page's
          bespoke section grew into (components/ExploreMore); each surface has
          one job, and naming the jobs is what keeps them from duplicating
          each other (brief §2/§50). */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <ExploreMore current="handbook" cityId={city.id} cityName={city.name} />
        </div>
      </section>

      {articles.length === 0 ? (
        /* Empty-DB bottom — folds the contributor pitch into the
           empty-state so the page doesn't end with two stacked CTAs
           saying related things. */
        <section className="bg-white">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
            <div aria-hidden="true" className="text-5xl mb-4">📝</div>
            {/* Honest per city: Tbilisi's index claimed a seeding of twenty
                articles under a description promising residence permits and
                banking. Nothing is seeded; someone has to write it, and that
                someone is the reader. */}
            <h2 className="text-xl font-extrabold text-gray-900 mb-2">The {city.name} Handbook starts with its first article</h2>
            <p className="text-sm text-gray-600 max-w-md mx-auto mb-6">
              Nothing here yet for {city.name}. Lived through something the rest of us are about to face — a permit, a bank, a landlord? Tell us and we&apos;ll write it together, under your name.
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
            {/* No badge is promised: none exists. */}
            <p className="text-sm text-gray-600 max-w-md mx-auto mb-6">
              Write the article you wish had existed when you arrived — it goes up under your name, and we edit it together. Tell us the topic.
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
