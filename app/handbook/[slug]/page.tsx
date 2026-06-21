import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { sanitize } from '@/lib/sanitize'
import { HANDBOOK_TO_GUIDE } from '@/lib/handbook-links'

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

function formatDate(d: Date | string | null) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const post = await getHandbookArticle(slug)
  if (!post || post.kind !== 'handbook' || post.status !== 'published') return { title: 'Handbook — Smileys Community' }
  return {
    title:       `${post.title} — Istanbul Handbook | Smileys Community`,
    description: post.excerpt ?? `Smileys Community handbook: ${post.title}`,
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

        {post.coverImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.coverImage}
            alt={post.title}
            className="w-full h-56 sm:h-72 object-cover rounded-2xl mb-8"
          />
        )}

        {/* Header */}
        <span className={`inline-block px-2 py-1 rounded-full text-[11px] font-bold ${catCls}`}>{post.category}</span>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900 mt-4 mb-5 leading-[1.1] tracking-tight">
          {post.title}
        </h1>

        <div className="flex items-center gap-3 text-xs text-gray-600 mb-8 pb-8 border-b border-gray-100">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
            style={{ backgroundColor: post.author.color ?? '#f59e0b' }}>
            {post.author.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700">by {post.author.name}</p>
            <p className="text-xs text-gray-400">
              {post.publishedAt && `Published ${formatDate(post.publishedAt)}`}
              {post.updatedAt && post.publishedAt && new Date(post.updatedAt).getTime() !== new Date(post.publishedAt).getTime() &&
                ` · Last reviewed ${formatDate(post.updatedAt)}`}
            </p>
          </div>
        </div>

        {/* TL;DR — uses the existing excerpt field so the admin form
            doesn't need a new input. If excerpt is empty we just skip
            the box rather than render an awkward placeholder. */}
        {post.excerpt && (
          <div className="bg-amber-50 border-l-4 border-amber-400 rounded-r-xl p-5 mb-10">
            <p className="text-[10px] font-extrabold text-amber-700 uppercase tracking-widest mb-2">TL;DR</p>
            <p className="text-sm sm:text-base text-amber-950 leading-relaxed">{post.excerpt}</p>
          </div>
        )}

        {/* Body — sanitised admin-authored HTML. Prose styling kept
            modest so it reads like a manual, not a magazine. */}
        <div
          className="prose prose-sm sm:prose-base max-w-none
                     prose-headings:font-extrabold prose-headings:tracking-tight prose-headings:text-gray-900
                     prose-h2:mt-10 prose-h2:mb-3 prose-h2:text-xl sm:prose-h2:text-2xl
                     prose-h3:mt-6 prose-h3:mb-2 prose-h3:text-base sm:prose-h3:text-lg
                     prose-p:text-gray-700 prose-p:leading-relaxed
                     prose-a:text-amber-600 hover:prose-a:underline prose-a:no-underline
                     prose-strong:text-gray-900
                     prose-li:text-gray-700
                     prose-ul:my-4 prose-ol:my-4
                     prose-blockquote:border-l-amber-300 prose-blockquote:text-gray-600 prose-blockquote:not-italic"
          dangerouslySetInnerHTML={{ __html: sanitize(post.body) }}
        />

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
