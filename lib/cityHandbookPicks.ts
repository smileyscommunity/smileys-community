import { unstable_cache } from 'next/cache'
import { prisma } from './prisma'
import { articleCover } from './articleCover'

// The city page's "Start here" shelf: the Handbook articles written for THIS
// city (its transport card, Istanbul's apartment and family guides), most read
// first. The page used to offer only a "The <city> Handbook" button, so a
// visitor to /antalya never learned the AntalyaKart guide existed.
//
// City-pinned rows only — not postCityScope: the national articles already
// fill the Handbook index, and this shelf's job is the one thing that is
// specific to the city. A city with none (Tbilisi on day one) gets an empty
// list and the shelf hides.
//
// Cached values stream to the browser, so only what a card renders leaves
// here: the body is read to find the cover and then dropped. The cover never
// falls back to the category banner — those are text graphics, not photos.
export const getCityHandbookPicks = unstable_cache(
  async (cityId: string) => {
    const rows = await prisma.post.findMany({
      where:   { kind: 'handbook', status: 'published', cityId },
      orderBy: [{ views: 'desc' }, { publishedAt: 'desc' }],
      take:    3,
      select:  { slug: true, title: true, excerpt: true, coverImage: true, body: true },
    })
    return rows.map(r => ({
      slug:    r.slug,
      title:   r.title,
      excerpt: r.excerpt,
      cover:   articleCover({ coverImage: r.coverImage, body: r.body }),
    }))
  },
  ['city-handbook-picks'],
  { revalidate: 300, tags: ['handbook'] },
)

export type CityHandbookPick = Awaited<ReturnType<typeof getCityHandbookPicks>>[number]
