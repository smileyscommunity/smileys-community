import Link from 'next/link'
import { notFound } from 'next/navigation'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { HANDBOOK_CATEGORIES as CATEGORIES } from '@/lib/handbook-categories'

const getHandbookCategory = unstable_cache(
  async (category: string) => prisma.post.findMany({
    where:   { kind: 'handbook', status: 'published', category },
    orderBy: { publishedAt: 'desc' },
    select:  { id: true, slug: true, title: true, excerpt: true, publishedAt: true, author: { select: { name: true } } },
  }),
  ['handbook-category'],
  { revalidate: 300, tags: ['handbook'] },
)

function formatDate(d: Date | string | null) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

type Params = { params: Promise<{ key: string }> }

export async function generateMetadata({ params }: Params) {
  const { key } = await params
  const cat = CATEGORIES[decodeURIComponent(key) as keyof typeof CATEGORIES]
  if (!cat) return { title: 'Handbook — Smileys Community' }
  return {
    title:       `${cat.label} — Istanbul Handbook | Smileys Community`,
    description: cat.tagline,
  }
}

export default async function HandbookCategoryPage({ params }: Params) {
  const { key } = await params
  const decoded = decodeURIComponent(key)
  const cat = CATEGORIES[decoded as keyof typeof CATEGORIES]
  if (!cat) notFound()

  const articles = await getHandbookCategory(decoded)

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
              No articles in this category yet — first ones coming soon.
            </div>
          ) : articles.map((a, i) => {
            // The first article gets the category image alongside it:
            // a thumbnail on the left (stacked on top on mobile). The
            // rest render text-only. Padding moves to the inner column
            // so the flanked and text-only cards look identical apart
            // from the image.
            const withImage = i === 0 && cat.image
            return (
              <Link key={a.id} href={`/handbook/${a.slug}`}
                className="block bg-white rounded-2xl border border-gray-200 overflow-hidden hover:border-amber-300 hover:shadow-sm hover:-translate-y-0.5 transition-all group">
                <div className={withImage ? 'flex items-stretch' : ''}>
                  {withImage && (
                    <div className="w-28 sm:w-56 shrink-0 bg-gray-100 overflow-hidden">
                      <img src={cat.image!.src} alt={cat.image!.alt}
                        className="w-full h-full object-cover" loading="eager" decoding="async" />
                    </div>
                  )}
                  <div className="p-6 min-w-0">
                    <div className="flex items-center gap-2 mb-2 text-xs text-gray-600">
                      {a.publishedAt && <span>{formatDate(a.publishedAt)}</span>}
                      {a.author?.name && <span>· by {a.author.name.split(' ')[0]}</span>}
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
        </div></div>
      </section>
    </main>
  )
}
