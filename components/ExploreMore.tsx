import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getCityConfig } from '@/lib/city'
import { postCityScope } from '@/lib/postScope'

// "Need something else?" — the shared cross-link grid, promoted from the
// Handbook's bespoke section. Every content surface names the OTHER surfaces
// and their one-line jobs, in the site's own vocabulary: each surface has one
// job, and saying the jobs out loud is what keeps them from bleeding into
// each other (handbook brief §2/§50).
//
// Async server component — mounted at the foot of /handbook, /guide, /posts,
// /neighborhoods and /directory. NOT mounted on /board: BoardHub is a client
// component and the board links out via its own nav; the tiles here link TO
// board. Width conventions come from the mounting page — this renders only
// the heading + grid, inside whatever container the page already uses.
//
// Surfaces that can be genuinely empty for a young city (guide, stories,
// neighborhoods) hide their tile rather than link to a shelf with nothing on
// it; handbook, directory and board always show (the handbook's global
// articles apply everywhere, and the other two are useful from day one).

export type ExploreMoreSurface =
  | 'guide' | 'handbook' | 'stories' | 'neighborhoods' | 'directory' | 'board'

// One cached lookup per city: does each optional surface have anything to
// show? Keyed by cityId — never a shared entry across cities. Dedicated
// 'explore-more' tag: the existing 'handbook'/'posts' tags each cover only
// one of these three counts, so reusing either would leave the others stale
// past their own events; revalidate keeps the answer fresh within 5 min.
const getSurfaceCounts = unstable_cache(
  async (cityId: string, country: string | null) => {
    const [guideEntries, stories, neighborhoods] = await Promise.all([
      prisma.guideEntry.count({ where: { cityId, status: 'published' } }),
      // Same scope as /posts (lib/postScope): this city, its country's, global.
      prisma.post.count({ where: { kind: 'community', status: 'published', ...postCityScope(cityId, country) } }),
      prisma.neighborhood.count({ where: { cityId, active: true } }),
    ])
    return { guideEntries, stories, neighborhoods }
  },
  ['explore-more'],
  { revalidate: 300, tags: ['explore-more'] },
)

export default async function ExploreMore({ current, cityId, cityName }: {
  current: ExploreMoreSurface
  cityId: string
  cityName: string
}) {
  // Country rides along for the post scope; getCityConfig is cached.
  const counts = await getSurfaceCounts(cityId, (await getCityConfig(cityId)).country ?? null)

  const surfaces: { key: ExploreMoreSurface; href: string; emoji: string; label: string; job: string; show: boolean }[] = [
    { key: 'guide',         href: '/guide',         emoji: '🗺️', label: 'Guide',         job: `Experience ${cityName}`,     show: counts.guideEntries > 0 },
    { key: 'handbook',      href: '/handbook',      emoji: '📖', label: 'Handbook',      job: 'How the city works',         show: true },
    { key: 'stories',       href: '/posts',         emoji: '📰', label: 'Stories',       job: "What we're writing",         show: counts.stories > 0 },
    { key: 'neighborhoods', href: '/neighborhoods', emoji: '🏘️', label: 'Neighborhoods', job: 'Find your part of the city', show: counts.neighborhoods > 0 },
    { key: 'directory',     href: '/directory',     emoji: '🏪', label: 'Directory',     job: 'Places members trust',       show: true },
    { key: 'board',         href: '/board',         emoji: '💬', label: 'Board',         job: 'Ask the community',          show: true },
  ]
  const tiles = surfaces.filter(s => s.key !== current && s.show)

  return (
    <section>
      <h2 className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-6">Need something else?</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map(s => (
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
    </section>
  )
}
