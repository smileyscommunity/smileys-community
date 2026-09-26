import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/session'
import { resolveCityId, getCityConfig } from '@/lib/city'
import { nowInTz } from '@/lib/cityTime'
import { getCityTz } from '@/lib/city'
import { buildShelves, experienceWindow } from '@/lib/experiences'
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
//
// Upcoming / cancelled / sold-out rules mirror the events feed — see
// lib/experiences for why each one is there.

export const metadata: Metadata = {
  title: 'Experiences — Smileys Community',
  description: 'Sailing, workshops, day trips and culture — curated experiences you can join with the Smileys community.',
  alternates: { canonical: `${APP_URL}/experiences` },
}

const CARD_SELECT = {
  id: true, title: true, emoji: true, date: true, time: true,
  location: true, neighborhood: true, coverImage: true, coverImagePosition: true,
  price: true, memberPrice: true, currency: true,
  spotsLeft: true, totalSpots: true, limitedSpots: true, soldOut: true, status: true,
  seriesId: true, isRecurring: true,
  club: { select: { name: true, emoji: true, slug: true } },
  tags: { select: { tag: { select: { name: true, emoji: true, group: { select: { name: true } } } } } },
} as const

const getExperiencesData = unstable_cache(
  async (cityId: string) => {
    // "Today" and the started-cutoff in the CITY's clock, not the founding
    // city's — Tbilisi's evening is an hour off Istanbul's.
    const { today, cutoffTime } = experienceWindow(nowInTz(await getCityTz(cityId)))
    const events = await prisma.event.findMany({
      where: {
        cityId,
        // Cancelled rides along so the card can say so (the feed does the
        // same); drafts and the rest stay out.
        status: { in: ['published', 'cancelled'] },
        OR: [
          { date: { gt: today } },
          { AND: [{ date: today }, { time: { gte: cutoffTime } }] },
        ],
        tags: { some: { tag: { group: { name: 'Experience' } } } },
      },
      select: CARD_SELECT,
      orderBy: [{ date: 'asc' }, { time: 'asc' }],
      take: 80,
    })
    return buildShelves(events)
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
              {shelf.cards.map(({ event: e, cadence, moreDates, moreCount, cancelledDates, cancelled, soldOut }) => (
                <Link key={e.id} href={`/events/${e.id}`}
                  className={`card overflow-hidden group hover:-translate-y-0.5 transition-transform${cancelled ? ' opacity-80' : ''}`}>
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
                    {/* Same stamps as EventCard: cancelled greys the cover out,
                        sold out only dims it — the detail page still offers
                        the waitlist. */}
                    {cancelled && (
                      <>
                        <div className="absolute inset-0 bg-red-950/45 backdrop-grayscale pointer-events-none" />
                        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
                          <span className="bg-red-600 text-white text-xs font-extrabold tracking-widest uppercase px-3 py-1 rounded-md shadow-lg -rotate-6">
                            Cancelled
                          </span>
                        </div>
                      </>
                    )}
                    {soldOut && !cancelled && (
                      <>
                        <div className="absolute inset-0 bg-gray-950/35 pointer-events-none" />
                        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
                          <span className="bg-violet-600 text-white text-xs font-extrabold tracking-widest uppercase px-3 py-1 rounded-md shadow-lg -rotate-6">
                            Sold out
                          </span>
                        </div>
                      </>
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
                    {moreDates.length > 0 && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        Also {moreDates.map(formatShortDate).join(' · ')}{moreCount > moreDates.length ? ` · +${moreCount - moreDates.length} more` : ''}
                      </p>
                    )}
                    {cancelledDates.length > 0 && (
                      <p className="text-xs text-red-600 mt-0.5">
                        {cancelledDates.map(formatShortDate).join(' · ')} cancelled
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-3">
                      <span className={`text-sm font-bold ${cancelled ? 'text-red-600' : soldOut ? 'text-violet-700' : 'text-gray-900'}`}>
                        {cancelled ? 'Cancelled' : soldOut ? 'Sold out · waitlist' : e.price === 0 ? 'Free' : formatPrice(e.price, e.currency)}
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
