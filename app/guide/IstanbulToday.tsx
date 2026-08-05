import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { loadExperiences } from '@/lib/guideContent'
import type { Experience } from '@/lib/guide'

// §5 of the Guide plan — "Istanbul Today": the page reacting to the
// actual time of day and season in Istanbul instead of being a static
// brochure. Server component; the page's 5-minute ISR window means the
// time bucket lags a boundary by at most a few minutes. All Istanbul
// time math uses Europe/Istanbul + h23 per house rules (UTC+3, no DST).
//
// Weather-aware suggestions stay deferred — this is time + season only.

type Bucket = 'morning' | 'afternoon' | 'evening' | 'night'
type Season = 'summer' | 'winter' | 'shoulder'

function istanbulNow(): { hour: number; month: number } {
  const now = new Date()
  const hour  = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/Istanbul' }).format(now))
  const month = Number(new Intl.DateTimeFormat('en-GB', { month: 'numeric', timeZone: 'Europe/Istanbul' }).format(now))
  return { hour, month }
}

// Five candidates per cell — the first three NOT already shown higher on
// the page render, so the homepage stops repeating the same experiences
// across sections (reviewer feedback). Order = preference.
const PICKS: Record<Bucket, Record<Season, string[]>> = {
  morning: {
    summer:   ['turkish-breakfast', 'balat-fener-walk', 'kadikoy-market-graze', 'bebek-rumeli-walk', 'princes-islands'],
    winter:   ['turkish-breakfast', 'turkish-coffee-slow', 'historic-peninsula-sanely', 'turkish-hammam', 'kadikoy-market-graze'],
    shoulder: ['turkish-breakfast', 'kadikoy-market-graze', 'balat-fener-walk', 'bebek-rumeli-walk', 'historic-peninsula-sanely'],
  },
  afternoon: {
    summer:   ['princes-islands', 'bebek-rumeli-walk', 'moda-sunset', 'belgrad-forest', 'kadikoy-market-graze'],
    winter:   ['turkish-hammam', 'historic-peninsula-sanely', 'turkish-coffee-slow', 'kadikoy-market-graze', 'balat-fener-walk'],
    shoulder: ['bebek-rumeli-walk', 'historic-peninsula-sanely', 'belgrad-forest', 'balat-fener-walk', 'princes-islands'],
  },
  evening: {
    summer:   ['ferry-at-sunset', 'moda-sunset', 'rooftop-sunset-drinks', 'uskudar-evening', 'meyhane-night'],
    winter:   ['ferry-at-sunset', 'meyhane-night', 'turkish-hammam', 'uskudar-evening', 'live-music-night'],
    shoulder: ['ferry-at-sunset', 'uskudar-evening', 'rooftop-sunset-drinks', 'moda-sunset', 'meyhane-night'],
  },
  night: {
    summer:   ['meyhane-night', 'live-music-night', 'rooftop-sunset-drinks', 'uskudar-evening', 'moda-sunset'],
    winter:   ['meyhane-night', 'live-music-night', 'turkish-coffee-slow', 'turkish-hammam', 'rooftop-sunset-drinks'],
    shoulder: ['meyhane-night', 'live-music-night', 'uskudar-evening', 'rooftop-sunset-drinks', 'ferry-at-sunset'],
  },
}

const HEADLINE: Record<Bucket, { title: string; line: string }> = {
  morning:   { title: 'Good morning, Istanbul', line: 'Start slow — this city does mornings properly.' },
  afternoon: { title: 'Daylight worth spending', line: 'A few hours of Istanbul at its most generous.' },
  evening:   { title: 'Sunset is coming',        line: "Golden hour is Istanbul's best hour. Be somewhere good for it." },
  night:     { title: 'Istanbul at night',       line: "The city's second shift is just getting started." },
}

// Deterministic within a request — the page calls this too, so it can
// exclude Today's picks from other sections without prop plumbing.
export function computeTodayPicks(exclude: string[] = []): { bucket: Bucket; slugs: string[] } {
  const { hour, month } = istanbulNow()
  const bucket: Bucket =
    hour >= 6 && hour < 12 ? 'morning'
    : hour >= 12 && hour < 17 ? 'afternoon'
    : hour >= 17 && hour < 22 ? 'evening'
    : 'night'
  const season: Season =
    month >= 6 && month <= 9 ? 'summer'
    : month === 12 || month <= 2 ? 'winter'
    : 'shoulder'
  const candidates = PICKS[bucket][season]
  let slugs = candidates.filter(s => !exclude.includes(s)).slice(0, 3)
  // If exclusions gut the list, time-relevance wins over de-duplication.
  if (slugs.length < 2) slugs = candidates.slice(0, 3)
  return { bucket, slugs }
}

export default async function IstanbulToday({ exclude = [] }: { exclude?: string[] }) {
  const { bucket, slugs } = computeTodayPicks(exclude)
  const bySlug = new Map(loadExperiences().map(e => [e.slug, e]))
  const picks = slugs.map(s => bySlug.get(s)).filter((e): e is Experience => !!e)

  // §5's "connect" line — today's organized events (public data). Counted
  // in Istanbul's calendar day; silent when zero.
  const todayIst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date())
  const eventsToday = await prisma.event.count({ where: { status: 'published', date: todayIst } })

  const { title, line } = HEADLINE[bucket]

  return (
    <div className="mt-12 bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-100 rounded-3xl p-6 sm:p-8">
      <p className="text-xs font-bold text-amber-700 uppercase tracking-widest mb-1.5">Istanbul today</p>
      <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-gray-900">{title}</h2>
      <p className="text-gray-600 mt-1 mb-5">{line}</p>
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
