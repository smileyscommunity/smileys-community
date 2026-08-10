import Link from 'next/link'
import { readFileSync } from 'fs'
import { join } from 'path'
import TransitLinks, { type Category } from '@/components/TransitLinks'
import HandbookSearch from '@/components/HandbookSearch'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { resolveImageUrl } from '@/lib/data'
import { canonicalCategory, categoryMeta, categoryHero, CATEGORY_KEYS, HANDBOOK_CATEGORIES } from '@/lib/handbook-categories'
import { reviewLabel, readingTime } from '@/lib/handbook-review'
import type { HandbookSearchItem } from '@/lib/handbook-search'
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
    select:  {
      id: true, slug: true, title: true, excerpt: true, body: true, coverImage: true, category: true,
      publishedAt: true, lastReviewedAt: true, reviewIntervalDays: true, tags: true, views: true,
      author: { select: { name: true } },
    },
  }),
  ['handbook-articles'],
  { revalidate: 300, tags: ['handbook'] },
)

// Fixed-size cover (1200×800) so we can assert real dimensions, unlike the
// variable-aspect article photos. Served from public/ under the /app basePath.
const HANDBOOK_OG_IMAGE = `${APP_URL}/images/handbook-cover.jpg`
const HANDBOOK_OG_DESC  = 'Understand Istanbul. Practical answers for living, moving and navigating life in Istanbul — residence permits, banking, healthcare, transport — written by Smileys members who actually lived it.'

export const metadata = {
  alternates: { canonical: `${APP_URL}/handbook` },
  title: 'The Istanbul Handbook — Understand Istanbul | Smileys Community',
  description: HANDBOOK_OG_DESC,
  openGraph: {
    title: 'The Istanbul Handbook — Understand Istanbul',
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
    title: 'The Istanbul Handbook — Understand Istanbul',
    description: HANDBOOK_OG_DESC,
    images: [HANDBOOK_OG_IMAGE],
  },
}

// "Start here" — the questions people actually arrive with, each pointing at
// its canonical article (brief §9: cards link to canonical Handbook content,
// never to duplicated summaries). Curated by slug; a card whose article is
// missing or unpublished simply doesn't render, so a slug rename can't leave
// a dead card on the most-trafficked section of the page.
const START_HERE: { slug: string; emoji: string; label: string }[] = [
  { slug: 'istanbulkart-mastery',                          emoji: '🚇', label: 'Get around with Istanbulkart' },
  { slug: 'opening-turkish-bank-account',                  emoji: '💳', label: 'Open a bank account' },
  { slug: 'residence-permit-first-application',            emoji: '🛂', label: 'Get your residence permit' },
  { slug: 'healthcare-in-istanbul-how-the-system-works',   emoji: '🏥', label: 'Use the healthcare system' },
  { slug: 'scams-tourist-traps-in-t-rkiye-how-to-stay-safe-without-becoming-paranoid', emoji: '🛡️', label: 'Avoid scams & stay safe' },
  { slug: 'daily-life-in-istanbul-the-little-things-that-make-a-big-difference',       emoji: '🏠', label: 'Set up daily life' },
  { slug: 'family-life-in-istanbul-raising-children-with-confidence',                  emoji: '👨‍👩‍👧', label: 'Move with children' },
]

// The other surfaces and their jobs, in the site's own vocabulary (brief §2).
// The Handbook explains how Istanbul works; everything else has a different
// question to answer, and saying so out loud is what keeps the surfaces from
// bleeding into each other.
const OTHER_SURFACES = [
  { href: '/guide',         emoji: '🗺️', label: 'Guide',         job: 'Experience Istanbul' },
  { href: '/directory',     emoji: '🏪', label: 'Directory',     job: 'Find a business or service' },
  { href: '/neighborhoods', emoji: '🏘️', label: 'Neighborhoods', job: 'Find your part of the city' },
  { href: '/board',         emoji: '💬', label: 'Board',         job: 'Ask the community' },
]

function formatReviewedShort(d: Date | string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Quick-reference links (apps, official sites, practical how-tos) —
// moved here from /guide in the information-architecture cleanup: the
// Handbook owns "how Istanbul works", the Guide owns experiences. The
// content still lives in data/city-guide.json (server-authoritative,
// edited via /admin's guide editor). Food & Drink is skipped: its
// cultural content was rebuilt as Guide experiences.
function loadQuickReference(): Category[] {
  try {
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'data', 'city-guide.json'), 'utf8'))
    return (raw.categories ?? [])
      .filter((cat: { label?: string }) => cat.label !== 'Food & Drink')
      .map((cat: { icon: string; label: string; updatedAt?: string; resources?: unknown[] }) => ({
        icon:      cat.icon,
        label:     cat.label,
        color:     'bg-amber-100 text-amber-700',
        updatedAt: cat.updatedAt,
        resources: ((cat.resources ?? []) as { title: string; description: string; href?: string; badge?: string; tip?: string }[]).map(r => ({
          title:       r.title,
          description: r.description,
          href:        r.href || undefined,
          badge:       r.badge || undefined,
          badgeColor:  r.badge ? 'bg-amber-100 text-amber-700' : undefined,
          tip:         r.tip  || undefined,
        })),
      }))
  } catch {
    return []
  }
}

export default async function HandbookPage() {
  const articles = await getHandbookArticles()

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
  const enrichedBySlug = new Map(enriched.map(e => [e.slug, e]))

  const startHere = START_HERE
    .filter(c => bySlug.has(c.slug))
    .map(c => ({ ...c, article: enrichedBySlug.get(c.slug)! }))

  // Latest — newest 5, rendered as flanked image cards. Each card carries a
  // review chip when (and only when) the article has a real lastReviewedAt
  // (brief §38's maintenance signal, folded into the list rather than a
  // separate text strip repeating the same articles; §14: never a fake date).
  const latest = articles.slice(0, 5)

  return (
    <main>
      {/* Hero + search share one band: the hero is deliberately compact
          (two lines, no photo — brief §7/§41) so search reads as the page's
          primary action, not a widget below the fold. */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-10">
          <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">
            📖 The Istanbul Handbook
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">
            Understand <span className="text-amber-600">Istanbul.</span>
          </h1>
          <p className="text-base text-gray-600 mt-1 max-w-xl">
            Practical answers for living, moving and navigating life in Istanbul —
            written by Smileys members who actually lived it.
          </p>
          <div className="max-w-2xl mt-6">
            <HandbookSearch items={enriched} />
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
                  className="bg-white border border-gray-200 rounded-2xl p-4 hover:border-amber-300 hover:shadow-md hover:-translate-y-0.5 transition-all group">
                  <div aria-hidden="true" className="text-2xl mb-2">{c.emoji}</div>
                  <p className="text-sm font-extrabold text-gray-900 group-hover:text-amber-600 transition-colors leading-tight">
                    {c.label}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-1">{c.article.minutes} min read</p>
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
                    className="block bg-gradient-to-br from-gray-50 to-white border-gray-200 text-gray-900 border rounded-2xl p-6 hover:-translate-y-0.5 hover:shadow-md transition-all group">
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
                          {a.author?.name && <span>by {a.author.name.split(' ')[0]}</span>}
                          <span>· {e?.minutes ?? 1} min read</span>
                          {a.lastReviewedAt && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 font-bold">
                              <span aria-hidden="true">✓</span> Reviewed {formatReviewedShort(a.lastReviewedAt)}
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

      {/* Need something else? — each surface has one job; naming the jobs is
          what keeps them from duplicating each other (brief §2/§50). */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-6">Need something else?</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {OTHER_SURFACES.map(s => (
              <Link key={s.href} href={s.href}
                className="bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-2xl px-4 py-4 transition-colors group">
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className="text-2xl shrink-0">{s.emoji}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-gray-900 group-hover:text-amber-600 transition-colors">{s.label}</p>
                    <p className="text-xs text-gray-600">{s.job}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {articles.length === 0 ? (
        /* Empty-DB bottom — folds the contributor pitch into the
           empty-state so the page doesn't end with two stacked CTAs
           saying related things. */
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
              Members who write a Handbook article get a permanent <span className="font-semibold text-amber-600">Contributor badge</span> and our deep gratitude. DM us the topic and we&apos;ll edit it together.
            </p>
            <Link href="/contact?topic=handbook" className="inline-block px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors">
              Pitch a topic →
            </Link>
          </div>
        </section>
      )}
      {(() => {
        const quickRef = loadQuickReference()
        if (quickRef.length === 0) return null
        return (
          <section className="bg-white border-t border-gray-100">
            {/* max-w-7xl matches every other handbook section so the
                heading shares the page's left edge; the link list itself
                stays reading-width (TransitLinks was designed for a
                3xl column) but left-aligned, not floating centered. */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">Quick reference</h2>
              <p className="text-gray-600 mt-1 mb-8">
                Apps, official sites and practical links for functioning in Istanbul — vetted by the Smileys team, updated regularly.
              </p>
              <div className="max-w-3xl">
                <TransitLinks categories={quickRef} />
              </div>
            </div>
          </section>
        )
      })()}
    </main>
  )
}
