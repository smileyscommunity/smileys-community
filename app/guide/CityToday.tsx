import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { loadExperiences } from '@/lib/guideContent'
import type { Experience } from '@/lib/guide'
import { computeTodayPicks, HEADLINE } from '@/lib/guideToday'

// §5 of the Guide plan — "<City> Today": the page reacting to the actual time
// of day and season instead of being a static brochure. Server component; the
// page's 5-minute ISR window means the time bucket lags a boundary by at most a
// few minutes. Time math runs in the CITY's zone (h23 per house rules — never
// hour12:false, which renders midnight as 24:MM on server ICU).
//
// Picks: Istanbul keeps its hand-curated slug table. Any other city derives
// them from its own mood/collection vocabulary, because inventing a second
// curated table means inventing local knowledge — and a city's guide is
// supposed to be the one thing that isn't guessed.
//
// Weather-aware suggestions stay deferred — this is time + season only.

export default async function CityToday(
  { exclude = [], cityId, citySlug, cityName, timezone }:
  { exclude?: string[]; cityId: string; citySlug: string; cityName: string; timezone: string },
) {
  const experiences = await loadExperiences(cityId)
  if (experiences.length === 0) return null
  const { bucket, slugs } = computeTodayPicks(exclude, { citySlug, timezone, available: experiences })
  const bySlug = new Map(experiences.map(e => [e.slug, e]))
  const picks = slugs.map(s => bySlug.get(s)).filter((e): e is Experience => !!e)
  if (picks.length === 0) return null

  // §5's "connect" line — today's organized events (public data), in THIS
  // city's calendar day and THIS city's events. It counted every city's.
  const todayHere = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  const eventsToday = await prisma.event.count({ where: { status: 'published', date: todayHere, cityId } })

  const { title, line } = HEADLINE[bucket]

  return (
    <div className="mt-12 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100 rounded-3xl p-6 sm:p-8">
      <p className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-1.5">{cityName} today</p>
      <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-gray-900">{title(cityName)}</h2>
      <p className="text-gray-600 mt-1 mb-5">{line(cityName)}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {picks.map(e => (
          <Link key={e.slug} href={`/guide/${e.slug}`}
            className="bg-white border border-amber-100 rounded-2xl p-4 hover:border-amber-300 hover:shadow-md transition-all group">
            <span aria-hidden="true" className="block text-3xl mb-2">{e.emoji}</span>
            <p className="text-sm font-bold text-gray-900 leading-snug group-hover:text-amber-700 transition-colors">{e.title}</p>
            <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{e.tagline}</p>
          </Link>
        ))}
      </div>
      {eventsToday > 0 && (
        <Link href="/events" className="inline-block mt-5 text-sm font-bold text-amber-700 hover:underline">
          {eventsToday} Smileys event{eventsToday !== 1 ? 's' : ''} today →
        </Link>
      )}
    </div>
  )
}
