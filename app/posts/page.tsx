import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { resolveImageUrl } from '@/lib/data'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Articles & Stories — Smileys Community',
  description: 'Club spotlights, event recaps, Istanbul guides, and tips for making the most of Smileys. Stories from Istanbul\'s most vibrant social community.',
  openGraph: {
    title: 'Articles & Stories — Smileys Community',
    description: 'Club spotlights, Istanbul guides, and stories from the Smileys community.',
    url: 'https://smileyscommunity.com/posts',
  },
}

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

export default async function PostsPage() {
  const posts = await prisma.post.findMany({
    where: { status: 'published' },
    orderBy: { publishedAt: 'desc' },
    include: { author: { select: { name: true } } },
  }).catch(() => [] as never[])

  const featured = posts[0] ?? null
  const rest = posts.slice(1)

  const categories = Array.from(new Set(posts.map(p => p.category)))

  return (
    <main className="min-h-screen bg-warm">
      {/* Hero */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase mb-6">
            ✦ Community Articles
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight mb-4">
            Stories & guides
          </h1>
          <p className="text-lg text-gray-500 max-w-xl">
            Club spotlights, event recaps, Istanbul guides, and tips for making the most of Smileys.
          </p>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {posts.length === 0 ? (
          <div className="text-center py-24 text-gray-400">
            <div className="text-5xl mb-4">📝</div>
            <p className="font-semibold text-gray-500 text-lg">No articles yet</p>
            <p className="text-sm mt-2">Check back soon — we're working on something.</p>
          </div>
        ) : (
          <>
            {/* Featured article */}
            {featured && (
              <Link href={`/posts/${featured.slug}`} className="group block mb-12">
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow duration-300">
                  {featured.coverImage ? (
                    <div className="relative h-64 sm:h-80 overflow-hidden">
                      <img
                        src={resolveImageUrl(featured.coverImage)}
                        alt={featured.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    </div>
                  ) : (
                    <div className="h-48 bg-gradient-to-br from-amber-100 to-orange-100 flex items-center justify-center">
                      <span className="text-6xl">📖</span>
                    </div>
                  )}
                  <div className="p-6 sm:p-8">
                    <div className="flex items-center gap-2 mb-3">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${categoryColors[featured.category] ?? 'bg-gray-100 text-gray-600'}`}>
                        {featured.category}
                      </span>
                      <span className="text-xs text-gray-400">Featured</span>
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 group-hover:text-amber-600 transition-colors mb-3 leading-tight">
                      {featured.title}
                    </h2>
                    {featured.excerpt && (
                      <p className="text-gray-500 leading-relaxed mb-4">{featured.excerpt}</p>
                    )}
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <span>{featured.author.name}</span>
                      <span>·</span>
                      <span>{formatDate(featured.publishedAt)}</span>
                    </div>
                  </div>
                </div>
              </Link>
            )}

            {/* Rest of articles */}
            {rest.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {rest.map(post => (
                  <Link key={post.id} href={`/posts/${post.slug}`} className="group block">
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 h-full flex flex-col">
                      {post.coverImage ? (
                        <div className="h-40 overflow-hidden shrink-0">
                          <img
                            src={resolveImageUrl(post.coverImage)}
                            alt={post.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        </div>
                      ) : (
                        <div className="h-28 bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center shrink-0">
                          <span className="text-4xl">📖</span>
                        </div>
                      )}
                      <div className="p-5 flex-1 flex flex-col">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full self-start mb-2 ${categoryColors[post.category] ?? 'bg-gray-100 text-gray-600'}`}>
                          {post.category}
                        </span>
                        <h3 className="font-bold text-gray-900 group-hover:text-amber-600 transition-colors leading-snug mb-2 flex-1">
                          {post.title}
                        </h3>
                        {post.excerpt && (
                          <p className="text-xs text-gray-500 leading-relaxed mb-3 line-clamp-2">{post.excerpt}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-auto">{formatDate(post.publishedAt)}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
