import Image from 'next/image'
import Link from 'next/link'
import { CITY_STATUS, CITY_STATUS_META, type PublicCity } from '@/lib/cityStatus'
import { resolveImageUrl } from '@/lib/data'
import { countryName } from '@/lib/country'
import CityInterestLink from '@/components/CityInterestLink'

// One card, every city, every stage. A city moves coming_soon → preparing →
// live by an admin changing a dropdown; this component is what makes that flip
// visible everywhere without a code change.
//
// The design rule that matters: a city that isn't live shows no numbers and no
// "explore" link. Zeros on a card read as a dead community rather than a future
// one, and an explore link into an empty city is worse than no link at all.

const TONE: Record<string, string> = {
  live:   'bg-emerald-500 text-white',
  soon:   'bg-white/90 text-gray-700 ring-1 ring-gray-200',
  muted:  'bg-gray-200 text-gray-600',
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-xl font-extrabold text-gray-900 tabular-nums">{value.toLocaleString('en-US')}</div>
      <div className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">{label}</div>
    </div>
  )
}

export default function CityCard({ city, featured = false }: { city: PublicCity; featured?: boolean }) {
  const isLive = city.status === CITY_STATUS.Live
  const meta   = CITY_STATUS_META[city.status]

  // Falls back rather than blocking: a city created two minutes ago with no
  // marketing copy yet still renders as a real card.
  const tagline = city.tagline ?? (isLive
    ? `Your international social life in ${city.name}.`
    : `Smileys is coming to ${city.name}.`)

  const body = (
    <div className={`card h-full overflow-hidden ${isLive ? 'group-hover:-translate-y-1 transition-transform duration-300' : ''}`}>
      <div className={`relative ${featured ? 'aspect-[16/9]' : 'aspect-[3/2]'} bg-gradient-to-br from-amber-100 to-amber-200`}>
        {city.heroImage ? (
          <Image
            src={resolveImageUrl(city.heroImage)}
            alt={`${city.name} — Smileys community`}
            fill
            sizes={featured ? '(max-width: 1024px) 100vw, 66vw' : '(max-width: 768px) 100vw, 33vw'}
            className={`object-cover ${isLive ? '' : 'grayscale opacity-60'}`}
            priority={featured}
          />
        ) : (
          // No photo yet — a flat wash with the city initial, not a broken
          // image or an empty grey box.
          <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
            <span className="text-6xl font-extrabold text-amber-700/30">{city.name.charAt(0)}</span>
          </div>
        )}

        <div className="absolute top-3 left-3">
          <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${TONE[meta.tone]}`}>
            {isLive && <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full bg-white mr-1.5 align-middle" />}
            {meta.label}
          </span>
        </div>
      </div>

      <div className="p-5">
        <div className="flex items-baseline gap-2 mb-1">
          <h3 className={`font-extrabold text-gray-900 ${featured ? 'text-2xl' : 'text-lg'}`}>{city.name}</h3>
          <span className="text-xs text-gray-500 tracking-wide">{countryName(city.country)}</span>
        </div>

        <p className="text-sm text-gray-600 leading-relaxed">{tagline}</p>

        {isLive && city.stats && (
          <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-gray-100">
            <Stat value={city.stats.members} label="Members" />
            <Stat value={city.stats.clubs}   label="Clubs" />
            <Stat value={city.stats.events}  label="Upcoming" />
          </div>
        )}

        <div className="mt-4">
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-600 group-hover:gap-2.5 transition-all">
              Explore {city.name}
              <span aria-hidden="true">→</span>
            </span>
          ) : (
            // Not a dead end. Guests go to the apply form (which carries the
            // city through); signed-in members register interest instead —
            // sending an existing member to /apply asks them to apply to
            // Smileys a second time.
            <CityInterestLink slug={city.slug} name={city.name} />
          )}
        </div>
      </div>
    </div>
  )

  // Only live cities are clickable as a whole; for the rest the inner "Get
  // notified" link is the only affordance, so the card can't promise a
  // destination that has nothing on it.
  return isLive
    ? <Link href={`/${city.slug}`} className="group block h-full">{body}</Link>
    : <div className="h-full">{body}</div>
}
