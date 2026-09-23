import { unstable_cache } from 'next/cache'
import { prisma } from './prisma'
import { postCityScope } from './postScope'

// A city's published Handbook articles, projected to what a LISTING shows:
// title, excerpt, category, city, review state, and whether the article cites
// official sources (a flag — the article page lists them). Shared by the
// pages that arrange existing articles rather than render them: the
// remote-work and moving hubs, and the Handbook's life-stage pages.
//
// Scoped by the one rule in lib/postScope. City and country are cache-key
// arguments, never read from the request inside, so one city's list is never
// served to another.
export const getCityHandbookIndex = unstable_cache(
  async (cityId: string, country: string | null) => {
    const rows = await prisma.post.findMany({
      where:   { kind: 'handbook', status: 'published', ...postCityScope(cityId, country) },
      orderBy: { publishedAt: 'desc' },
      select:  {
        slug: true, title: true, excerpt: true, category: true, cityId: true,
        lastReviewedAt: true, reviewIntervalDays: true, officialSources: true,
      },
    })
    return rows.map(({ officialSources, ...a }) => ({
      ...a, hasOfficialSources: Array.isArray(officialSources) && officialSources.length > 0,
    }))
  },
  ['city-handbook-index'],
  { revalidate: 300, tags: ['handbook'] },
)

export type HandbookIndexArticle = Awaited<ReturnType<typeof getCityHandbookIndex>>[number]
