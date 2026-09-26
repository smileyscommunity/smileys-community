import { unstable_cache } from 'next/cache'
import { prisma } from './prisma'

// "Next in the series" — a reading order, which is a different thing from the
// related grid already at the foot of an article.
//
// Only categories that genuinely run in sequence belong here. Most do not:
// "Getting Around" is six parallel city transit cards, so a Next link there
// would send someone reading about Istanbul to İzmir, and "Community" is
// chronological announcements with no order to follow. For those the related
// grid ("More from X") is the honest offer — a Next label promises a sequence
// that does not exist. Add a category here only when reading it in order is
// actually the point.
export const SERIES_CATEGORIES: string[] = ['Tips', 'Working from']

export const isSeriesCategory = (category: string) => SERIES_CATEGORIES.includes(category)

/**
 * The article published after this one, within the same kind, category and
 * city scope.
 *
 * City scope matters for a series that runs per city: 'Working from' is one
 * interview a month in each city, and the Next link under Istanbul's must
 * not hand the reader İzmir's (the transit-card objection above, in series
 * form). A global series (Tips: cityId null) is unaffected — null matches
 * only the other global pieces.
 *
 * Order is publish-date order, not editorial order. That is the right trade
 * while a series is short: no migration, nothing to maintain. It is also the
 * limitation to watch — backdating an article, or republishing an old one,
 * moves it in the sequence. Once a series is long enough for that to bite,
 * give Post explicit seriesSlug/seriesOrder columns and order on those
 * instead; this function is the only place that would need to change.
 *
 * `publishedAt` is passed as an ISO string so it keys the cache cleanly.
 */
export const getNextInSeries = unstable_cache(
  async (kind: string, category: string, publishedAtIso: string | null, cityId: string | null = null) => {
    // Guard before the query: a non-series category costs no database round-trip.
    if (!publishedAtIso || !isSeriesCategory(category)) return null
    return prisma.post.findFirst({
      where:   { status: 'published', kind, category, cityId, publishedAt: { gt: new Date(publishedAtIso) } },
      orderBy: { publishedAt: 'asc' },
      select:  { title: true, slug: true },
    })
  },
  ['post-next-in-series'],
  { revalidate: 300, tags: ['posts'] },
)
