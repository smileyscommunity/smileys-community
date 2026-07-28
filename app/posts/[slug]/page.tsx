import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { resolveImageUrl, avatarUrl } from '@/lib/data'
import { firstBodyImage } from '@/lib/articleCover'
import { APP_URL, SITE_URL } from '@/lib/env'
import { sanitize } from '@/lib/sanitize'
import ArticleInlineEditor from '@/components/ArticleInlineEditor'
import ArticleViewBeacon from '@/components/ArticleViewBeacon'

const getPost = unstable_cache(
  async (slug: string) => prisma.post.findUnique({
    where:   { slug },
    include: { author: { select: { name: true, color: true, profilePhoto: true } } },
  }),
  ['post'],
  { revalidate: 300, tags: ['posts'] },
)

const getRelatedPosts = unstable_cache(
  async (category: string, excludeSlug: string) => prisma.post.findMany({
    where:   { status: 'published', category, slug: { not: excludeSlug } },
    orderBy: { publishedAt: 'desc' },
    take:    3,
    select:  { title: true, slug: true, excerpt: true, coverImage: true, publishedAt: true },
  }),
  ['posts-related'],
  { revalidate: 300, tags: ['posts'] },
)

const categoryColors: Record<string, string> = {
  'Community':     'bg-amber-100 text-amber-700',
  'Club Stories':  'bg-violet-100 text-violet-700',
  'Events':        'bg-blue-100 text-blue-700',
  'Istanbul Guide':'bg-green-100 text-green-700',
  'Tips':          'bg-pink-100 text-pink-700',
}

function formatDate(d: Date | string | null) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

function renderBody(text: string) {
  return text.split('\n\n').map((block, i) => {
    const trimmed = block.trim()
    if (!trimmed) return null

    if (trimmed.startsWith('## ')) {
      return (
        <h2 key={i} className="text-2xl font-extrabold text-gray-900 mt-10 mb-4">
          {trimmed.slice(3)}
        </h2>
      )
    }

    if (trimmed.startsWith('### ')) {
      return (
        <h3 key={i} className="text-xl font-bold text-gray-800 mt-8 mb-3">
          {trimmed.slice(4)}
        </h3>
      )
    }

    if (trimmed.split('\n').every(l => l.startsWith('- '))) {
      const items = trimmed.split('\n').map(l => l.slice(2))
      return (
        <ul key={i} className="list-disc list-inside space-y-2 text-gray-600 leading-relaxed my-5 ml-2">
          {items.map((item, j) => (
            <li key={j} dangerouslySetInnerHTML={{ __html: sanitize(item.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')) }} />
          ))}
        </ul>
      )
    }

    const html = trimmed
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br />')
    return (
      <p key={i} className="text-gray-600 leading-relaxed my-5 text-[17px]"
        dangerouslySetInnerHTML={{ __html: sanitize(html) }} />
    )
  })
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) return {}
  // Prefer the article's own photo — explicit cover, else the first inline
  // <img> most authors paste at the top of the body — so shared links show a
  // real, article-specific image instead of the generic /api/og brand card.
  // ?w=1200 hits the file route's PREVIEW resize (1200-wide JPEG q75, aspect
  // preserved); WhatsApp / iMessage / X all drop OG images > ~600 KB, and the
  // original PNGs run multi-MB.
  const cover    = post.coverImage ?? firstBodyImage(post.body)
  const resolved = cover ? resolveImageUrl(cover) : ''
  // Only trust a rooted same-origin path or an absolute https URL; a data:/
  // relative src would build a malformed OG url, so fall back to the card.
  const usable   = resolved.startsWith('/') || resolved.startsWith('http')
  const imageUrl = usable
    ? (resolved.startsWith('http') ? resolved : `${SITE_URL}${resolved}?w=1200`)
    : `${APP_URL}/api/og`
  // The /api/og card is exactly 1200×630; a real photo has a variable aspect,
  // so only assert dimensions for the card and let FB/X read a photo's true
  // size (a wrong height hint mis-crops the first scrape).
  const ogImage  = usable
    ? { url: imageUrl, secureUrl: imageUrl, alt: post.title }
    : { url: imageUrl, secureUrl: imageUrl, width: 1200, height: 630, alt: post.title }
  return {
    title: `${post.title} — Smileys Community`,
    description: post.excerpt ?? post.body.slice(0, 155),
    // Self-referencing canonical → the clean URL, so ?v=<cacheKey> share links
    // and other query variants aren't indexed as duplicate pages.
    alternates: { canonical: `${APP_URL}/posts/${slug}` },
    openGraph: {
      title: post.title,
      description: post.excerpt ?? post.body.slice(0, 155),
      url: `${APP_URL}/posts/${slug}`,
      siteName: 'Smileys Community',
      type: 'article',
      images: [ogImage],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.excerpt ?? post.body.slice(0, 155),
      images: [imageUrl],
    },
  }
}

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post || post.status !== 'published') notFound()

  const related = await getRelatedPosts(post.category, slug)

  return (
    <main className="min-h-screen bg-warm">
      {/* Back */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-3">
          <Link href="/posts" className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-amber-600 transition-colors font-medium">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            All articles
          </Link>
        </div>
      </div>

      {/* Cover image */}
      {post.coverImage && (
        <div className="relative w-full h-64 sm:h-96 overflow-hidden">
          <img
            src={resolveImageUrl(post.coverImage)}
            alt={post.title}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Article */}
      <article className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
       <ArticleInlineEditor
         postId={post.id}
         initial={{
           title:      post.title,
           excerpt:    post.excerpt ?? '',
           body:       post.body,
           category:   post.category,
           status:     post.status,
           coverImage: post.coverImage,
         }}
       >
        {/* Meta */}
        <div className="flex items-center gap-2 mb-4">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${categoryColors[post.category] ?? 'bg-gray-100 text-gray-600'}`}>
            {post.category}
          </span>
        </div>

        <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight leading-tight mb-4">
          {post.title}
        </h1>

        {post.excerpt && (
          <p className="text-lg text-gray-600 leading-relaxed mb-6 border-l-4 border-amber-400 pl-4">
            {post.excerpt}
          </p>
        )}

        {/* Author */}
        <div className="flex items-center gap-3 mb-10 pb-8 border-b border-gray-100">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 overflow-hidden"
            style={{ backgroundColor: post.author.color ?? '#f59e0b' }}
          >
            {post.author.profilePhoto
              ? <img src={avatarUrl(post.author.profilePhoto, 64)} alt={post.author.name} loading="lazy" decoding="async" className="w-full h-full object-cover" />
              : post.author.name[0].toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{post.author.name}</p>
            <p className="text-xs text-gray-400">
              {formatDate(post.publishedAt)}
              {post.views > 0 && ` · 👁 ${post.views.toLocaleString()} view${post.views === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>
        <ArticleViewBeacon slug={post.slug} />

        {/* Body */}
        <div className="prose-like">
          {renderBody(post.body)}
        </div>
       </ArticleInlineEditor>

        {/* CTA */}
        <div className="mt-16 p-8 bg-amber-500 rounded-2xl text-center">
          <p className="text-white font-extrabold text-xl mb-2">Ready to experience this?</p>
          <p className="text-amber-100 text-sm mb-5">Join Smileys and become part of Istanbul's most vibrant social community.</p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link href="/apply" className="px-6 py-2.5 rounded-xl bg-white text-amber-600 font-bold text-sm hover:bg-amber-50 transition-colors">
              Apply to join
            </Link>
            <Link href="/events" className="px-6 py-2.5 rounded-xl border border-amber-400/50 text-white font-semibold text-sm hover:bg-amber-600 transition-colors">
              Browse events
            </Link>
          </div>
        </div>
      </article>

      {/* Related articles */}
      {related.length > 0 && (
        <section className="bg-white border-t border-gray-100">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
            <h2 className="text-xl font-extrabold text-gray-900 mb-6">More from {post.category}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              {related.map(r => (
                <Link key={r.slug} href={`/posts/${r.slug}`} className="group block bg-gray-50 hover:bg-amber-50 rounded-2xl p-5 border border-gray-100 hover:border-amber-200 transition-all">
                  <h3 className="font-bold text-gray-900 group-hover:text-amber-600 transition-colors text-sm leading-snug mb-2">{r.title}</h3>
                  {r.excerpt && <p className="text-xs text-gray-600 line-clamp-2">{r.excerpt}</p>}
                  <p className="text-xs text-gray-400 mt-3">{formatDate(r.publishedAt)}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  )
}
