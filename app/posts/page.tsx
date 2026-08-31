import Link from 'next/link'
import { APP_URL } from '@/lib/env'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId, getCityConfig } from '@/lib/city'
import { avatarUrl } from '@/lib/data'
import { articleCover } from '@/lib/articleCover'
import { readingTime } from '@/lib/handbook-review'
import ExploreMore from '@/components/ExploreMore'

// Scoped to the viewer's city, same contract as the Handbook index: a null
// cityId means global (most community stories are), so those show everywhere;
// only genuinely city-local stories are filtered out. cityId is part of the
// cache key, not captured from the request inside it — one shared cache entry
// per city, never a city's stories served to another.
//
// kind: 'community' so handbook articles don't leak into the /posts listing.
// The Post table is shared between /posts (kind = 'community') and /handbook
// (kind = 'handbook').
const getPosts = unstable_cache(
  async (cityId: string) => prisma.post.findMany({
    where:   { kind: 'community', status: 'published', OR: [{ cityId }, { cityId: null }] },
    orderBy: { publishedAt: 'desc' },
    select:  {
      id: true, slug: true, title: true, excerpt: true, body: true, coverImage: true,
      category: true, publishedAt: true,
      author: { select: { name: true, color: true, profilePhoto: true } },
    },
  }),
  ['posts-list'],
  { revalidate: 300, tags: ['posts'] },
)

// See app/about/page.tsx — a page-level `openGraph` block loses the root
// layout's default og:image, so this shared with no preview at all on
// WhatsApp/iMessage/Twitter until this was added.
const ogImage = `${APP_URL}/api/og?${new URLSearchParams({
  title:   'Stories from Smileys',
  eyebrow: 'Smileys Community',
  cta:     'Read the stories',
}).toString()}`

// One name in every slot (see tests/surfaceNaming.test.ts). This page called
// itself four different things — "Stories" in the nav, "Community Articles" on
// the eyebrow, "Stories & Guides" in the h1 and "Articles & Stories" here —
// and two of them promised guides. It has none: the query above is
// `kind: 'community'` and excludes handbook articles outright. Guides live at
// /guide (places and experiences) and /handbook (how things work here).
//
// Deliberately city-neutral (a plain `metadata` export, no session read):
// the list is scoped per viewer, but the page's identity is the community's.
export const metadata = {
  alternates: { canonical: `${APP_URL}/posts` },
  title: 'Stories from Smileys',
  description: 'Club spotlights, event recaps, and tips for making the most of Smileys — written by the community, about the community.',
  openGraph: {
    title: 'Stories from Smileys',
    description: 'Club spotlights, event recaps and tips, written by the Smileys community.',
    url: `${APP_URL}/posts`,
    siteName: 'Smileys Community',
    images: [{ url: ogImage, width: 1200, height: 630, alt: 'Stories from Smileys' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Stories from Smileys',
    description: 'Club spotlights, event recaps and tips, written by the Smileys community.',
    images: [ogImage],
  },
}

const categoryColors: Record<string, string> = {
  'Community':     'bg-amber-100 text-amber-700',
  'Club Stories':  'bg-violet-100 text-violet-700',
  'Events':        'bg-blue-100 text-blue-700',
  'Tips':          'bg-pink-100 text-pink-700',
}

function formatDate(d: Date | string | null) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

// The small colour-dot avatar from the article page's byline, listing-sized.
function AuthorDot({ author, size = 'w-6 h-6' }: {
  author: { name: string; color: string | null; profilePhoto: string | null }
  size?: string
}) {
  return (
    <span
      className={`${size} rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 overflow-hidden`}
      style={{ backgroundColor: author.color ?? '#f59e0b' }}
    >
      {author.profilePhoto
        ? <img src={avatarUrl(author.profilePhoto, 64)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
        : author.name[0]?.toUpperCase()}
    </span>
  )
}

export default async function PostsPage() {
  const cityId = await resolveCityId(await getSession())
  const [city, posts] = await Promise.all([getCityConfig(cityId), getPosts(cityId)])

  const featured = posts[0] ?? null
  const rest = posts.slice(1)
  // Cover priority matches the article page's share image: explicit cover,
  // else the first inline <img> most authors paste at the top of the body.
  // No category-banner fallback — community categories aren't handbook ones.
  const featuredCover = featured ? articleCover({ coverImage: featured.coverImage, body: featured.body }) : null

  return (
    <main className="min-h-screen bg-warm">
      {/* Hero */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-6">
          <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">
            📰 Stories from Smileys
          </span>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-gray-900 tracking-tight">
            Stories
          </h1>
          <p className="text-base text-gray-600 mt-1 max-w-xl">
            Club spotlights, event recaps, and tips for making the most of Smileys.
          </p>
          <p className="text-sm text-gray-500 mt-4">
            Looking for how the city works?{' '}
            <Link href="/handbook" className="font-semibold text-amber-600 hover:underline">
              The {city.name} Handbook →
            </Link>
          </p>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {posts.length === 0 ? (
          /* A city with no local stories and no globals — rare, since most
             stories are global, but a fresh DB gets here. Honest, no filler. */
          <div className="text-center py-24 text-gray-400">
            <div aria-hidden="true" className="text-5xl mb-4">📝</div>
            <p className="font-semibold text-gray-600 text-lg">No stories yet</p>
            <p className="text-sm mt-2">The first ones are being written — check back soon.</p>
          </div>
        ) : (
          <>
            {/* Lead card — the newest story */}
            {featured && (
              <Link href={`/posts/${featured.slug}`} className="group block mb-12">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow duration-300">
                  {featuredCover ? (
                    <div className="relative h-64 sm:h-80 overflow-hidden bg-gray-100">
                      <img
                        src={featuredCover}
                        alt={featured.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        decoding="async"
                      />
                    </div>
                  ) : (
                    <div aria-hidden="true" className="h-48 bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center">
                      <span className="text-6xl">📖</span>
                    </div>
                  )}
                  <div className="p-6 sm:p-8">
                    <div className="flex items-center gap-2 mb-3">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${categoryColors[featured.category] ?? 'bg-gray-100 text-gray-600'}`}>
                        {featured.category}
                      </span>
                      <span aria-hidden="true" className="text-xs text-gray-300">·</span>
                      <span className="text-xs text-gray-400">Latest</span>
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 group-hover:text-amber-600 transition-colors mb-3 leading-tight">
                      {featured.title}
                    </h2>
                    {featured.excerpt && (
                      <p className="text-gray-600 leading-relaxed mb-4">{featured.excerpt}</p>
                    )}
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <AuthorDot author={featured.author} />
                      <span>{featured.author?.name || 'Smileys team'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDate(featured.publishedAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{readingTime(featured.body)} min read</span>
                    </div>
                  </div>
                </div>
              </Link>
            )}

            {/* The rest */}
            {rest.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {rest.map(post => {
                  const cover = articleCover({ coverImage: post.coverImage, body: post.body })
                  return (
                    <Link key={post.id} href={`/posts/${post.slug}`} className="group block">
                      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 h-full flex flex-col">
                        {cover ? (
                          <div className="relative h-40 overflow-hidden shrink-0 bg-gray-100">
                            <img
                              src={cover}
                              alt={post.title}
                              loading="lazy"
                              decoding="async"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                          </div>
                        ) : (
                          <div aria-hidden="true" className="h-28 bg-gradient-to-br from-amber-50 to-orange-50 flex items-center justify-center shrink-0">
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
                            <p className="text-xs text-gray-600 leading-relaxed mb-3 line-clamp-2">{post.excerpt}</p>
                          )}
                          <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-auto">
                            <AuthorDot author={post.author} size="w-5 h-5" />
                            <span className="truncate">{post.author?.name || 'Smileys team'}</span>
                            <span aria-hidden="true">·</span>
                            <span className="whitespace-nowrap">{formatDate(post.publishedAt)}</span>
                          </div>
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Cross-links — the shared surface grid (components/ExploreMore). */}
        <div className="mt-14 pt-10 border-t border-gray-100">
          <ExploreMore current="stories" cityId={cityId} cityName={city.name} />
        </div>
      </div>
    </main>
  )
}
