import { notFound } from 'next/navigation'
import { jsonLdHtml } from '@/lib/jsonLd'
import { headers } from 'next/headers'
import Link from 'next/link'
import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId, getCityConfig, DEFAULT_CITY_SLUG } from '@/lib/city'
import { postCityScope } from '@/lib/postScope'
import { sanitizeArticle } from '@/lib/sanitize'
import { resolveImageUrl } from '@/lib/data'
import { firstBodyImage } from '@/lib/articleCover'
import { SITE_URL, APP_URL } from '@/lib/env'
import { HANDBOOK_TO_GUIDE } from '@/lib/handbook-links'
import { canonicalCategory, categoryMeta, storedKeysFor } from '@/lib/handbook-categories'
import { reviewLabel, readingTime, parseOfficialSources } from '@/lib/handbook-review'
import SocialShare from '@/components/SocialShare'
import ArticleLike from '@/components/ArticleLike'
import HandbookArticleTracker from '@/components/HandbookArticleTracker'
import ArticleViewBeacon from '@/components/ArticleViewBeacon'
import EditableArticle from './EditableArticle'

// Cover image → absolute, WhatsApp/iMessage-safe OG image (same helper shape
// as the events page). ?w=1200 hits the file route's preview resize so the
// image stays under the ~600 KB OG cap. When the article has no cover, fall
// back to the /api/og title card (article title + category as the eyebrow)
// so a shared link still gets a tailored preview, not the generic brand card.
function ogImageUrl(coverImage: string | null | undefined, title: string, category: string, handbookName: string): string {
  const resolved = coverImage ? resolveImageUrl(coverImage) : ''
  if (resolved.startsWith('http')) return resolved
  // Only a rooted same-origin path is safe to prefix with the origin; a data:/
  // relative src would build a malformed url, so fall through to the title card.
  if (resolved.startsWith('/')) return `${SITE_URL}${resolved}?w=1200`
  const params = new URLSearchParams({
    title,
    eyebrow: category ? `${category} · ${handbookName}` : handbookName,
  })
  return `${APP_URL}/api/og?${params.toString()}`
}

const getHandbookArticle = unstable_cache(
  async (slug: string) => prisma.post.findUnique({
    where:   { slug },
    include: { author: { select: { name: true, color: true, profilePhoto: true, bio: true } } },
  }),
  ['handbook-article'],
  { revalidate: 300, tags: ['handbook'] },
)

// Related articles are matched on the CANONICAL category, so an article still
// stored under a legacy key ('Daily Life') and one stored under the new key
// ('Home & Housing') recommend each other instead of sitting in separate
// silos during the transition.
//
// City-scoped like the index: a shared link to a city-local article still
// opens for anyone (the article query above is deliberately unscoped — an
// indexed URL must not start 404ing based on a cookie), but what we
// RECOMMEND alongside it stays in the reader's own city.
const getHandbookRelated = unstable_cache(
  async (storedKeys: string[], excludeId: string, cityId: string, country: string | null) => prisma.post.findMany({
    where:   { kind: 'handbook', status: 'published', category: { in: storedKeys }, NOT: { id: excludeId }, ...postCityScope(cityId, country) },
    orderBy: { publishedAt: 'desc' },
    take:    3,
    select:  { id: true, slug: true, title: true, excerpt: true },
  }),
  ['handbook-related'],
  { revalidate: 300, tags: ['handbook'] },
)

const CATEGORY_STYLES: Record<string, string> = {
  'Getting Started':      'bg-sky-100 text-sky-700',
  'Getting Around':       'bg-violet-100 text-violet-700',
  'Home & Housing':       'bg-amber-100 text-amber-700',
  'Money & Banking':      'bg-green-100 text-green-700',
  'Mobile & Digital':     'bg-cyan-100 text-cyan-700',
  'Healthcare':           'bg-teal-100 text-teal-700',
  'Residence & Legal':    'bg-blue-100 text-blue-700',
  'Everyday Life':        'bg-rose-100 text-rose-700',
  'Safety & Emergencies': 'bg-orange-100 text-orange-700',
  'Language & Culture':   'bg-fuchsia-100 text-fuchsia-700',
}

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const post = await getHandbookArticle(slug)
  if (!post || post.kind !== 'handbook' || post.status !== 'published') return { title: 'Handbook — Smileys Community' }
  // A city-local article is named by ITS city — an Istanbul viewer reading
  // İzmir's transport guide is not reading the "Istanbul Handbook". Global
  // articles take the viewer's city; a crawler sends no cookie, so those
  // resolve to the default city and the indexed titles are unchanged.
  const cityName    = (await getCityConfig(post.cityId ?? await resolveCityId(await getSession()))).name
  const title       = `${post.title} — ${cityName} Handbook | Smileys Community`
  const description = post.excerpt ?? `Smileys Community handbook: ${post.title}`
  const pageUrl     = `${APP_URL}/handbook/${slug}`
  const cover       = post.coverImage ?? firstBodyImage(post.body)
  const imageUrl    = ogImageUrl(cover, post.title, post.category, `${cityName} Handbook`)
  // The /api/og card is exactly 1200×630, but a real cover/body photo has a
  // variable aspect ratio — asserting 630 there gives FB/X a wrong hint that
  // mis-crops the preview on the first scrape. Derive the choice from what
  // ogImageUrl actually returned (a card when there's no usable image), so
  // only the card declares dimensions and a photo omits them.
  const isCard      = imageUrl.startsWith(`${APP_URL}/api/og`)
  const ogImage     = isCard
    ? { url: imageUrl, secureUrl: imageUrl, width: 1200, height: 630, alt: post.title }
    : { url: imageUrl, secureUrl: imageUrl, alt: post.title }
  return {
    title,
    description,
    // Self-referencing canonical → the clean URL, so the ?v=<cacheKey> share
    // links and any other query variants don't get indexed as duplicate pages.
    alternates: { canonical: pageUrl },
    openGraph: {
      title,
      description,
      url:      pageUrl,
      // siteName gives Facebook/LinkedIn a proper attribution line under the
      // headline instead of falling back to the bare domain. locale stops
      // them guessing the language from the page text.
      siteName: 'Smileys Community',
      locale:   'en_US',
      images:   [ogImage],
      type:     'article',
    },
    twitter: {
      card:        'summary_large_image',
      title,
      description,
      images:      [imageUrl],
    },
  }
}

export default async function HandbookArticlePage({ params }: Params) {
  const { slug } = await params
  const post = await getHandbookArticle(slug)
  if (!post || post.kind !== 'handbook' || post.status !== 'published') notFound()

  // Resolve the stored category to the canonical 10-category IA. A row whose
  // category matches nothing (an admin-form typo) still renders — it just
  // falls back to its raw label and gets no category-specific treatment.
  const canonical = canonicalCategory(post.category)
  const meta      = canonical ? categoryMeta(post.category) : null
  const catLabel  = meta?.label ?? post.category
  const catKey    = canonical ?? post.category

  const cityId   = await resolveCityId(await getSession())
  // Naming follows the article's own city when city-local (matches
  // generateMetadata); related-article scoping deliberately stays on the
  // VIEWER's city — see getHandbookRelated.
  const cityName = (await getCityConfig(post.cityId ?? cityId)).name
  // The "Quick links for this topic" callout deep-links into /handbook's
  // quick-reference block — Istanbul's link pack, rendered on the default
  // city's index only — so the callout follows the same gate (same rule as
  // handbookCity() on the index; per-city quick reference is the follow-up).
  const viewerCityIsDefault = (await getCityConfig(cityId)).slug === DEFAULT_CITY_SLUG

  const related = await getHandbookRelated(
    canonical ? storedKeysFor(canonical) : [post.category],
    post.id,
    cityId,
    (await getCityConfig(cityId)).country ?? null,
  )

  // Freshness + sources are computed server-side so the client component gets
  // settled strings (see EditableArticle's props comment).
  const review   = reviewLabel({
    category:           catKey,
    lastReviewedAt:     post.lastReviewedAt,
    reviewIntervalDays: post.reviewIntervalDays,
  })
  const minutes  = readingTime(post.body)
  const sources  = parseOfficialSources(post.officialSources)

  // Likes are read OUTSIDE getHandbookArticle's unstable_cache: the count
  // would go stale for 5 minutes, and "did you like this" is per-viewer so
  // it must never be shared across users by a cache entry.
  const session   = await getSession()
  const likeCount = await prisma.postLike.count({ where: { postId: post.id } })
  const likedByMe = session
    ? (await prisma.postLike.findUnique({
        where:  { postId_userId: { postId: post.id, userId: session.id } },
        select: { postId: true },
      })) !== null
    : false

  const catCls  = CATEGORY_STYLES[catKey] ?? 'bg-gray-100 text-gray-700'
  const pageUrl = `${APP_URL}/handbook/${post.slug}`

  // Read the per-request CSP nonce set by middleware so the JSON-LD <script>
  // isn't blocked. Article schema makes the public handbook eligible for
  // Google rich results — a top-of-funnel win since handbook is unauthenticated.
  const nonce = (await headers()).get('x-nonce') ?? undefined
  const articleJsonLd = {
    '@context':        'https://schema.org',
    '@type':           'Article',
    headline:          post.title,
    description:       post.excerpt ?? undefined,
    image:             ogImageUrl(post.coverImage ?? firstBodyImage(post.body), post.title, post.category, `${cityName} Handbook`),
    datePublished:     post.publishedAt ? new Date(post.publishedAt).toISOString() : undefined,
    dateModified:      post.updatedAt ? new Date(post.updatedAt).toISOString() : undefined,
    author:            { '@type': 'Person', name: post.author.name },
    publisher:         { '@type': 'Organization', name: 'Smileys Community', url: SITE_URL },
    mainEntityOfPage:  pageUrl,
    articleSection:    catLabel,
    // dateModified stays mapped to updatedAt — that is genuinely "when the
    // content changed". The editorial review date is a stricter, separate
    // claim and is surfaced in the UI, not smuggled into the SEO payload.
    ...(sources.length > 0 ? { citation: sources.map(s => s.url) } : {}),
  }

  return (
    <main className="bg-white">
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: jsonLdHtml(articleJsonLd),
        }}
      />
      <HandbookArticleTracker slug={post.slug} title={post.title} category={post.category} />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16"><article className="max-w-2xl">
        {/* Breadcrumb (the share affordance now lives only at the end of the
            article — icons at the top were removed). */}
        <nav className="flex items-center gap-2 text-xs text-gray-600 flex-wrap mb-6">
          <Link href="/handbook" className="hover:text-amber-600 font-semibold">📖 Handbook</Link>
          <span>›</span>
          <Link href={`/handbook/category/${encodeURIComponent(catKey)}`} className="hover:text-amber-600 font-semibold">{catLabel}</Link>
        </nav>

        {/* Header + quick summary + body live in a client component so staff can
            edit them inline (see EditableArticle). Content is still
            server-rendered for SEO; the body arrives pre-sanitised. */}
        {/* sanitizeArticle, not sanitize: handbook bodies come from the same
            RichTextEditor as community articles, so the strict sanitizer
            silently dropped every colour the toolbar offers. */}
        <EditableArticle
          id={post.id}
          title={post.title}
          excerpt={post.excerpt}
          sanitizedBody={sanitizeArticle(post.body)}
          rawBody={post.body}
          category={post.category}
          categoryLabel={catLabel}
          catCls={catCls}
          coverImage={post.coverImage}
          status={post.status}
          authorName={post.author.name}
          authorColor={post.author.color}
          publishedAt={post.publishedAt ? new Date(post.publishedAt).toISOString() : null}
          views={post.views}
          reviewText={review?.text ?? null}
          reviewStale={review?.stale ?? false}
          readingMinutes={minutes}
          highStakes={meta?.highStakes ?? false}
          hasSources={sources.length > 0}
        />
        <ArticleViewBeacon slug={post.slug} />

        {/* Official sources — the answer to "where can I verify this?". These
            sit immediately after the body, before the social/like row, because
            verifying is the natural next step for a reader who has just been
            told what to do. Rendered only when the article actually cites
            something: an empty "Official Sources" heading would imply a rigour
            the article hasn't earned.

            External links get rel=noopener noreferrer and open in a new tab so
            a member mid-application doesn't lose their place. */}
        {sources.length > 0 && (
          <section className="mt-10 pt-8 border-t border-gray-100">
            <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-1">Official sources</h2>
            <p className="text-xs text-gray-500 mb-4">
              Verify the current rules yourself — these are the authorities that set them.
            </p>
            <ul className="space-y-2">
              {sources.map(s => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer"
                    className="group flex items-start gap-2.5 rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-amber-300 hover:bg-amber-50/40 transition-colors">
                    <span aria-hidden="true" className="text-sm mt-0.5">🔗</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-gray-900 group-hover:text-amber-700 transition-colors">{s.label}</span>
                      <span className="block text-xs text-gray-500 truncate">{new URL(s.url).hostname.replace(/^www\./, '')}</span>
                    </span>
                    <span aria-hidden="true" className="text-xs text-gray-400 shrink-0 mt-1 group-hover:translate-x-0.5 transition-transform">↗</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Share — the handbook is public, so members can send an article
            to a friend who isn't in the community yet. cacheKey busts stale
            WhatsApp/Facebook link previews when the article is edited. */}
        <div className="mt-10 pt-8 border-t border-gray-100">
          {/* Like sits just above share: both are "I got something out of
              this" actions, and grouping them keeps one end-of-article
              row rather than two competing ones. */}
          <div className="mb-6">
            <ArticleLike
              slug={post.slug}
              initialCount={likeCount}
              initialLiked={likedByMe}
              isLoggedIn={session !== null}
            />
          </div>
          <SocialShare
            title={`${post.title} — Smileys Community ${cityName} Handbook`}
            url={`${APP_URL}/handbook/${post.slug}`}
            cacheKey={new Date(post.updatedAt ?? post.publishedAt ?? Date.now()).getTime().toString(36)}
          />
        </div>

        {/* Cross-link to the matching City Guide section. The handbook
            article gives the *how*; the guide gives the *what links
            to bookmark*. Showing both right at the end of the article
            answers the natural next question ("OK, now what app do I
            use?") without sending members away to search. */}
        {viewerCityIsDefault && HANDBOOK_TO_GUIDE[catKey] && (
          <section className="mt-12 pt-8 border-t border-gray-100">
            <Link href={`/handbook#${HANDBOOK_TO_GUIDE[catKey].anchor}`}
              className="block bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-2xl px-5 py-4 transition-colors group">
              <div className="flex items-center gap-4">
                <div className="text-2xl shrink-0">🗺️</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-amber-900">Quick links for this topic</p>
                  <p className="text-xs text-amber-700 mt-0.5">{HANDBOOK_TO_GUIDE[catKey].label} — curated by the Smileys team.</p>
                </div>
                <span className="text-sm font-bold text-amber-600 shrink-0 group-hover:translate-x-0.5 transition-transform">→</span>
              </div>
            </Link>
          </section>
        )}

        {/* Member-tips placeholder — visible affordance even before
            Q&A is shipped, so the layout doesn't visibly change later
            when comments come online. */}
        <section className="mt-10 pt-8 border-t border-gray-100">
          <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6 text-center">
            <p className="text-2xl mb-2">💬</p>
            <h3 className="text-base font-extrabold text-gray-900 mb-1">Got a tip or a twist your case taught you?</h3>
            <p className="text-sm text-gray-600 mb-4 max-w-md mx-auto">Member Q&A is coming to handbook articles. For now, share what worked for you with the community.</p>
            <Link href="/clubs" className="inline-block text-xs font-bold text-amber-600 hover:text-amber-700">
              Ask in your clubs →
            </Link>
          </div>
        </section>

        {related.length > 0 && (
          <section className="mt-12 pt-8 border-t border-gray-100">
            <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-4">More in {catLabel}</p>
            <div className="space-y-3">
              {related.map(r => (
                <Link key={r.id} href={`/handbook/${r.slug}`}
                  className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-amber-300 transition-colors group">
                  <h4 className="text-sm font-extrabold text-gray-900 group-hover:text-amber-600 transition-colors leading-tight mb-1">
                    {r.title}
                  </h4>
                  {r.excerpt && <p className="text-xs text-gray-600 line-clamp-1">{r.excerpt}</p>}
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className="mt-12 pt-6 border-t border-gray-100">
          <Link href="/handbook" className="text-sm text-amber-600 font-bold hover:underline">← Back to the Handbook</Link>
        </div>
      </article></div>
    </main>
  )
}
