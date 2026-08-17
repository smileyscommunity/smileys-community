// Pure logic for the Guide's "<City> Today" panel — which experiences suit the
// current time of day and season, in the city's own timezone.
//
// Lives in lib/ rather than beside the component because it is pure and the
// component is JSX: this is the part worth testing, and a test can't import a
// .tsx module. app/guide/CityToday.tsx renders what this decides.

export type Bucket = 'morning' | 'afternoon' | 'evening' | 'night'
type Season = 'summer' | 'winter' | 'shoulder'

function cityNow(timeZone: string): { hour: number; month: number } {
  const now = new Date()
  const hour  = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now))
  const month = Number(new Intl.DateTimeFormat('en-GB', { month: 'numeric', timeZone }).format(now))
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

// Templated on the city so the copy never claims one city's character for
// another — `city` is substituted at render.
export const HEADLINE: Record<Bucket, { title: (city: string) => string; line: (city: string) => string }> = {
  morning:   { title: c => `Good morning, ${c}`, line: () => 'Start slow — this place does mornings properly.' },
  afternoon: { title: () => 'Daylight worth spending', line: c => `A few hours of ${c} at its most generous.` },
  evening:   { title: () => 'Sunset is coming', line: c => `Golden hour is ${c}'s best hour. Be somewhere good for it.` },
  night:     { title: c => `${c} after dark`, line: () => "The second shift is just getting started." },
}

// The fallback ordering for a city with no curated table: which of its own
// moods/collections suit each part of the day. Values that a city doesn't use
// are simply skipped, so one list serves every vocabulary.
const BUCKET_PREFERENCE: Record<Bucket, string[]> = {
  morning:   ['eat', 'history', 'iconic', 'escape', 'peninsula', 'hidden'],
  afternoon: ['beach', 'beaches', 'boat', 'escape', 'peninsula', 'hidden', 'day-trips', 'iconic'],
  evening:   ['sunset', 'eat', 'people', 'boat'],
  night:     ['night-out', 'night', 'people', 'eat'],
}

export interface TodayContext {
  citySlug: string
  timezone: string
  // What the city actually has published — the fallback picks from this, so it
  // can never link to an experience that doesn't exist.
  available: { slug: string; moods: string[]; collection: string }[]
}

// Deterministic within a request — the page calls this too, so it can exclude
// Today's picks from other sections. Same ctx in, same slugs out.
export function computeTodayPicks(exclude: string[] = [], ctx: TodayContext): { bucket: Bucket; slugs: string[] } {
  const { hour, month } = cityNow(ctx.timezone)
  const bucket: Bucket =
    hour >= 6 && hour < 12 ? 'morning'
    : hour >= 12 && hour < 17 ? 'afternoon'
    : hour >= 17 && hour < 22 ? 'evening'
    : 'night'
  const season: Season =
    month >= 6 && month <= 9 ? 'summer'
    : month === 12 || month <= 2 ? 'winter'
    : 'shoulder'
  const curated = ctx.citySlug === 'istanbul' ? PICKS[bucket][season] : []
  // Only offer what this city has published; a curated slug that was unpublished
  // would otherwise leave a hole in the row.
  const have = new Set(ctx.available.map(e => e.slug))
  let candidates = curated.filter(s => have.has(s))
  if (candidates.length === 0) {
    const rank = BUCKET_PREFERENCE[bucket]
    candidates = ctx.available
      .map(e => {
        const keys = [...(e.moods ?? []), e.collection]
        const best = keys.reduce((lo, k) => {
          const i = rank.indexOf(k)
          return i >= 0 && i < lo ? i : lo
        }, Number.MAX_SAFE_INTEGER)
        return { slug: e.slug, best }
      })
      .filter(x => x.best !== Number.MAX_SAFE_INTEGER)
      .sort((a, b) => a.best - b.best)
      .map(x => x.slug)
  }
  let slugs = candidates.filter(s => !exclude.includes(s)).slice(0, 3)
  // If exclusions gut the list, time-relevance wins over de-duplication.
  if (slugs.length < 2) slugs = candidates.slice(0, 3)
  return { bucket, slugs }
}
