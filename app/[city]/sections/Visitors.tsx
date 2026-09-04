import Link from 'next/link'
import { formatShortDate, firstNameOf} from '@/lib/data'
import type { PublicCity, Visitors as VisitorsData } from '../data'

// Who's coming to town, and the door to announcing your own trip. Renders
// even when empty for LIVE cities: the empty state IS the invitation, and
// the announce CTA is how the first visitor card ever appears.
export default function Visitors({ city, visitors, visitorTotal, isDefaultCity }: {
  city: PublicCity; visitors: VisitorsData['visitors']; visitorTotal: number; isDefaultCity: boolean
}) {
  return (
    <section className="py-14 sm:py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h2 className="section-title">Visiting <span className="text-amber-600">{city.name}?</span></h2>
          <p className="section-subtitle max-w-2xl">
            {/* Four cards render and the rest are one click away for every
                city now, so the total is an honest number again — it was
                "4 of 12" while a second city had no way to reach them. */}
            {visitorTotal === 0
              ? 'Announce your trip and the community knows you’re coming before you land.'
              : `${visitorTotal} traveler${visitorTotal === 1 ? ' is' : 's are'} announcing a trip right now — announce yours and arrive with plans.`}
          </p>
        </div>
        {visitors.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {visitors.map(v => (
              <div key={v.id} className="card p-5">
                <p className="font-bold text-gray-900 truncate">{firstNameOf(v.name)}</p>
                <p className="text-xs text-gray-500 mt-0.5">{v.fromCity ? `from ${v.fromCity}` : 'traveling'}</p>
                <p className="text-xs font-semibold text-amber-600 mt-2">
                  {formatShortDate(v.startsOn)} – {formatShortDate(v.endsOn)}
                </p>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-4 flex-wrap">
          <Link href={`/visiting/new?city=${city.slug}`} className="btn-primary px-6 py-3">
            Announce your visit
          </Link>
          {/* Every city now, not just the default one: /visiting follows
              ?city= (a4d00f3), so the rest of a second city's travelers are
              reachable rather than advertised and hidden. */}
          <Link
            href={isDefaultCity ? '/visiting' : `/visiting?city=${city.slug}`}
            className="text-sm font-bold text-amber-600 hover:underline"
          >
            See all visitors →
          </Link>
        </div>
      </div>
    </section>
  )
}
