import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId, getCityConfig } from '@/lib/city'
import { todayInTz, DEFAULT_TZ } from '@/lib/cityTime'
import { groupBySeries, seriesCadenceLabel } from '@/lib/eventSeries'
import { formatPrice, formatShortDate, resolveImageUrl, BLUR_PLACEHOLDER } from '@/lib/data'
import { APP_URL } from '@/lib/env'

// Experiences (multi-city phase 2.4) — the bookable layer: sailing,
// workshops, day trips, culture. Deliberately NOT a new content type. The
// Guide answers "what should I experience here" (editorial); this page
// answers "what can I actually join" — and that already exists as events
// carrying Experience-group vibe tags. This surface curates them into
// shelves, grouped by series so "Sunset Sailing Cruise" is one card with a
// cadence line, not five near-identical cards. Sponsorship/partner slots
// can attach here later without a schema change.
//
// Public: every field selected is within the guest tier the events feed
// already serves (venue NAME is public; exact address/GPS/links are not
// selected at all — nothing to redact).

export const metadata: Metadata = {
  title: 'Experiences — Smileys Community',
  description: 'Sailing, workshops, day trips and culture — curated experiences you can join with the Smileys community.',
  alternates: { canonical: `${APP_URL}/experiences` },
}

const CARD_SELECT = {
  id: true, title: true, emoji: true, date: true, time: true,
  location: true, neighborhood: true, coverImage: true, coverImagePosition: true,
  price: true, memberPrice: true, currency: true,
  spotsLeft: true, totalSpots: true, limitedSpots: true,
  seriesId: true, isRecurring: true,
  club: { select: { name: true, emoji: true, slug: true } },
  tags: { select: { tag: { select: { name: true, emoji: true, group: { select: { name: true } } } } } },
} as const

const getExperiencesData = unstable_cache(
  async (cityId: string) => {
    const today = todayInTz(DEFAULT_TZ)
    const events = await prisma.event.findMany({
      where: {
        cityId, status: 'published', date: { gte: today },
        tags: { some: { tag: { group: { name: 'Experience' } } } },
      },
      select: CARD_SELECT,
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      take: 80,
    })

    // Shelf per Experience tag, in a stable curated order; an event with two
    // experience tags appears on both shelves (that's what shelves are for).
    const SHELF_ORDER = ['Outdoor', 'Adventure', 'Cultural', 'Food', 'Wellness']
    const shelves = new Map<string, { emoji: string; events: typeof events }>()
    for (const e of events) {
      for (const t of e.tags) {
        if (t.tag.group.name !== 'Experience') continue
        const shelf = shelves.get(t.tag.name) ?? { emoji: t.tag.emoji, events: [] }
        shelf.events.push(e)
        shelves.set(t.tag.name, shelf)
      }
    }
    return [...shelves.entries()]
      .sort((a, b) => {
        const ia = SHELF_ORDER.indexOf(a[0]); const ib = SHELF_ORDER.indexOf(b[0])
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      })
      .map(([name, s]) => ({
        name, emoji: s.emoji,
        groups: groupBySeries(s.events).map(g => ({
          event: g.next,
          cadence: seriesCadenceLabel(g),
          moreDates: g.isSeries ? g.upcoming.slice(0, 2).map(e => e.date) : [],
        })),
      }))
  },
  ['experiences-page-data'],
  { revalidate: 120, tags: ['experiences'] },
)

export default async function ExperiencesPage() {
  const session = await getSession()
  const cityId = await resolveCityId(session)
  const [shelves, city] = await Promise.all([getExperiencesData(cityId), getCityConfig(cityId)])

  return (
    <div className="min-h-screen bg-warm pb-20">
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-8">
          <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-2">Smileys {city.name}</p>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">Experiences</h1>
          <p className="text-base text-gray-600 mt-2 max-w-2xl">
            Sailing, workshops, day trips, culture — the experiences worth having in {city.name},
            joined with people worth having them with.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 space-y-12">
        {shelves.length === 0 ? (
          <div className="text-center py-16">
            <span aria-hidden="true" className="text-4xl block mb-3">✨</span>
            <p className="font-semibold text-gray-900 mb-1">Nothing scheduled right now</p>
            <p className="text-sm text-gray-600">
              New experiences are added every week — <Link href="/events" className="text-amber-600 font-semibold hover:underline">browse all events</Link> in the meantime.
            </p>
          </div>
        ) : shelves.map(shelf => (
          <section key={shelf.name}>
            <h2 className="text-xl font-extrabold tracking-tight text-gray-900 mb-4">
              <span aria-hidden="true">{shelf.emoji}</span> {shelf.name}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {shelf.groups.map(({ event: e, cadence }) => (
                <Link key={e.id} href={`/events/${e.id}`}
                  className="card overflow-hidden group hover:-translate-y-0.5 transition-transform">
                  <div className="relative aspect-[16/9] bg-gradient-to-br from-amber-100 to-amber-200">
                    {e.coverImage ? (
                      <Image
                        src={resolveImageUrl(e.coverImage)}
                        alt={e.title}
                        fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                        placeholder="blur" blurDataURL={BLUR_PLACEHOLDER}
                        className="object-cover"
                        style={{ objectPosition: `50% ${e.coverImagePosition ?? 50}%` }}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-5xl">{e.emoji}</div>
                    )}
                    {cadence && (
                      <span className="absolute top-3 left-3 bg-white/95 text-gray-900 text-[11px] font-bold px-2.5 py-1 rounded-full shadow-sm">
                        🔁 {cadence}
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    {/* No emoji prefix: legacy titles often carry their own
                        leading emoji (pre-splitLeadingEmoji rows), and the
                        cover fallback already renders e.emoji large. */}
                    <p className="font-bold text-gray-900 leading-snug group-hover:text-amber-700 transition-colors">
                      {e.title}
                    </p>
                    <p className="text-xs text-gray-500 mt-1.5">
                      {cadence ? `Next: ${formatShortDate(e.date)}` : formatShortDate(e.date)} · {e.time} · {e.neighborhood}
                    </p>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-sm font-bold text-gray-900">
                        {e.price === 0 ? 'Free' : formatPrice(e.price, e.currency)}
                      </span>
                      {e.club && (
                        <span className="text-xs text-gray-500">
                          <span aria-hidden="true">{e.club.emoji}</span> {e.club.name}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
