import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { resolveImageUrl, avatarUrl } from '@/lib/data'
import { firstBodyImage } from '@/lib/articleCover'
import { APP_URL, SITE_URL } from '@/lib/env'
import { sanitize, sanitizeArticle } from '@/lib/sanitize'
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

// Bodies come from two eras. The original authoring flow stored a markdown-ish
// string (`## heading`, `- bullet`, `**bold**`) that renderBody() styles block
// by block. PostForm / ArticleInlineEditor now use RichTextEditor, which stores
// HTML — and TipTap emits it as a single line with no blank lines, so
// renderBody saw a whole article as one "paragraph": it wrapped it in a styled
// <p> and injected the HTML inside, where the nested <p>s broke straight back
// out of that wrapper at parse time and took every body style with them (flat
// text, no bullets, headings the size of body copy). HTML bodies go to the
// prose container instead — same approach as the handbook.
const HTML_BODY_RE = /<(?:p|h[1-4]|ul|ol|li|blockquote|img|hr|br)\b[^>]*>/i

function isHtmlBody(body: string) {
  return HTML_BODY_RE.test(body)
}

// Styles the sanitized article HTML. Tailwind's preflight strips heading sizes,
// paragraph margins and list bullets, so without these the tags render flat.
// Values mirror renderBody's markdown styling so both eras look identical.
const BODY_PROSE = [
  'prose prose-lg max-w-none',
  'prose-headings:tracking-tight prose-headings:text-gray-900',
  'prose-h1:text-2xl prose-h1:font-extrabold prose-h1:mt-10 prose-h1:mb-4',
  'prose-h2:text-2xl prose-h2:font-extrabold prose-h2:mt-10 prose-h2:mb-4',
  'prose-h3:text-xl prose-h3:font-bold prose-h3:text-gray-800 prose-h3:mt-8 prose-h3:mb-3',
  'prose-h4:text-lg prose-h4:font-bold prose-h4:text-gray-800 prose-h4:mt-6 prose-h4:mb-2',
  // gray-700 body, matching the handbook article — gray-600 passes AA but
  // runs faint over long-form reading.
  'prose-p:text-[17px] prose-p:text-gray-700 prose-p:leading-relaxed prose-p:my-5',
  'prose-ul:my-5 prose-ol:my-5 prose-li:text-[17px] prose-li:text-gray-700 prose-li:my-1',
  '[&_li::marker]:text-amber-500',
  'prose-strong:font-bold prose-strong:text-gray-900',
  // A colour picked in the editor lands as `<span style="color: …">`, and a
  // child's own class beats a colour inherited from its parent — so bold text
  // inside a coloured span would render prose-strong's gray-900 and lose the
  // colour. Make anything nested in a styled span inherit it instead.
  '[&_span[style]_*]:text-[color:inherit]',
  'prose-a:text-amber-600 prose-a:font-medium',
  'prose-blockquote:border-l-4 prose-blockquote:border-amber-400 prose-blockquote:not-italic prose-blockquote:text-gray-600',
  'prose-img:rounded-2xl prose-img:mx-auto',
  // TipTap wraps each list item's text in its own <p>; prose's paragraph
  // margins would otherwise space single-line bullets like paragraphs.
  '[&_li>p]:my-0',
].join(' ')

// Meta/OG description fallback. Bodies are HTML now, so a raw slice would ship
// `<p>Smileys Community is growing — and <strong>…` as the share description.
function plainSummary(body: string, max = 155) {
  const text = body
    .replace(/<(?:br|\/p|\/h[1-4]|\/li)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:39|x27);/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, max)
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
    description: post.excerpt ?? plainSummary(post.body),
    // Self-referencing canonical → the clean URL, so ?v=<cacheKey> share links
    // and other query variants aren't indexed as duplicate pages.
    alternates: { canonical: `${APP_URL}/posts/${slug}` },
    openGraph: {
      title: post.title,
      description: post.excerpt ?? plainSummary(post.body),
      url: `${APP_URL}/posts/${slug}`,
      siteName: 'Smileys Community',
      type: 'article',
      images: [ogImage],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.excerpt ?? plainSummary(post.body),
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
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-3">
          <Link href="/posts" className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-amber-600 transition-colors font-medium">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            All stories
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
      {/* max-w-2xl (~65ch at 17px) — the handbook's reading measure, now
          shared so both long-form surfaces read identically. */}
      <article className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
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
        {isHtmlBody(post.body)
          ? <div className={BODY_PROSE} dangerouslySetInnerHTML={{ __html: sanitizeArticle(post.body) }} />
          : <div>{renderBody(post.body)}</div>}
       </ArticleInlineEditor>

        {/* CTA */}
        <div className="mt-16 p-8 bg-amber-500 rounded-2xl text-center">
          <p className="text-white font-extrabold text-xl mb-2">Ready to experience this?</p>
          <p className="text-amber-100 text-sm mb-5">Join Smileys and become part of the most vibrant social community in your city.</p>
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
