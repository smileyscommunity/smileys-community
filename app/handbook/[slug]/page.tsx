import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { sanitize } from '@/lib/sanitize'
import { resolveImageUrl } from '@/lib/data'
import { SITE_URL, APP_URL } from '@/lib/env'
import { HANDBOOK_TO_GUIDE } from '@/lib/handbook-links'
import SocialShare from '@/components/SocialShare'
import EditableArticle from './EditableArticle'

// Cover image → absolute, WhatsApp/iMessage-safe OG image (same helper shape
// as the events page). ?w=1200 hits the file route's preview resize so the
// image stays under the ~600 KB OG cap. When the article has no cover, fall
// back to the /api/og title card (article title + category as the eyebrow)
// so a shared link still gets a tailored preview, not the generic brand card.
function ogImageUrl(coverImage: string | null | undefined, title: string, category: string): string {
  if (coverImage) {
    const resolved = resolveImageUrl(coverImage)
    if (resolved.startsWith('http')) return resolved
    return `${SITE_URL}${resolved}?w=1200`
  }
  const params = new URLSearchParams({
    title,
    eyebrow: category ? `${category} · Istanbul Handbook` : 'Istanbul Handbook',
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

const getHandbookRelated = unstable_cache(
  async (category: string, excludeId: string) => prisma.post.findMany({
    where:   { kind: 'handbook', status: 'published', category, NOT: { id: excludeId } },
    orderBy: { publishedAt: 'desc' },
    take:    3,
    select:  { id: true, slug: true, title: true, excerpt: true },
  }),
  ['handbook-related'],
  { revalidate: 300, tags: ['handbook'] },
)

const CATEGORY_STYLES: Record<string, string> = {
  'Bureaucracy':    'bg-blue-100 text-blue-700',
  'Money':          'bg-green-100 text-green-700',
  'Daily Life':     'bg-amber-100 text-amber-700',
  'Family':         'bg-rose-100 text-rose-700',
  'Getting Around': 'bg-violet-100 text-violet-700',
}

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const post = await getHandbookArticle(slug)
  if (!post || post.kind !== 'handbook' || post.status !== 'published') return { title: 'Handbook — Smileys Community' }
  const title       = `${post.title} — Istanbul Handbook | Smileys Community`
  const description = post.excerpt ?? `Smileys Community handbook: ${post.title}`
  const pageUrl     = `${APP_URL}/handbook/${slug}`
  const imageUrl    = ogImageUrl(post.coverImage, post.title, post.category)
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url:    pageUrl,
      images: [{ url: imageUrl, secureUrl: imageUrl, width: 1200, height: 630, alt: post.title }],
      type:   'article',
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

  const related = await getHandbookRelated(post.category, post.id)

  const catCls = CATEGORY_STYLES[post.category] ?? 'bg-gray-100 text-gray-700'

  return (
    <main className="bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16"><article className="max-w-2xl">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs text-gray-600 mb-6 flex-wrap">
          <Link href="/handbook" className="hover:text-amber-600 font-semibold">📖 Handbook</Link>
          <span>›</span>
          <Link href={`/handbook/category/${encodeURIComponent(post.category)}`} className="hover:text-amber-600 font-semibold">{post.category}</Link>
        </nav>

        {/* Header + quick summary + body live in a client component so staff can
            edit them inline (see EditableArticle). Content is still
            server-rendered for SEO; the body arrives pre-sanitised. */}
        <EditableArticle
          id={post.id}
          title={post.title}
          excerpt={post.excerpt}
          sanitizedBody={sanitize(post.body)}
          rawBody={post.body}
          category={post.category}
          catCls={catCls}
          coverImage={post.coverImage}
          status={post.status}
          authorName={post.author.name}
          authorColor={post.author.color}
          publishedAt={post.publishedAt ? new Date(post.publishedAt).toISOString() : null}
          updatedAt={post.updatedAt ? new Date(post.updatedAt).toISOString() : null}
        />

        {/* Share — the handbook is public, so members can send an article
            to a friend who isn't in the community yet. cacheKey busts stale
            WhatsApp/Facebook link previews when the article is edited. */}
        <div className="mt-10 pt-8 border-t border-gray-100">
          <SocialShare
            title={`${post.title} — Smileys Community Istanbul Handbook`}
            url={`${APP_URL}/handbook/${post.slug}`}
            cacheKey={new Date(post.updatedAt ?? post.publishedAt ?? Date.now()).getTime().toString(36)}
          />
        </div>

        {/* Cross-link to the matching City Guide section. The handbook
            article gives the *how*; the guide gives the *what links
            to bookmark*. Showing both right at the end of the article
            answers the natural next question ("OK, now what app do I
            use?") without sending members away to search. */}
        {HANDBOOK_TO_GUIDE[post.category] && (
          <section className="mt-12 pt-8 border-t border-gray-100">
            <Link href={`/guide#${HANDBOOK_TO_GUIDE[post.category].anchor}`}
              className="block bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-2xl px-5 py-4 transition-colors group">
              <div className="flex items-center gap-4">
                <div className="text-2xl shrink-0">🗺️</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-amber-900">Quick links for this topic</p>
                  <p className="text-xs text-amber-700 mt-0.5">{HANDBOOK_TO_GUIDE[post.category].label} — curated by the Smileys team.</p>
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
            <p className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-4">More in {post.category}</p>
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
