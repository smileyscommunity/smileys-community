import type { PublicCity, EnterLink, NeighborhoodTile } from '../data'

// Every city now. /neighborhoods and /neighborhoods/[slug] both resolve
// against the viewer's city, so an İzmir slug is a real page rather than the
// 404 this gate existed to avoid. Links route through /api/city/enter so
// arriving from /izmir sets the view-city cookie first — without it a member
// whose home city is Istanbul would land on the İzmir slug and 404 all over
// again.
export default function Neighborhoods({ city, topNeighborhoods, neighborhoodsHaveEvents, enter }: {
  city: PublicCity; topNeighborhoods: NeighborhoodTile[]; neighborhoodsHaveEvents: boolean; enter: EnterLink
}) {
  if (topNeighborhoods.length === 0) return null
  return (
    <section className="py-12 sm:py-16 bg-gray-50 border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="section-title">Explore by neighborhood</h2>
            {/* Don't promise weekly events to a city that has none yet —
                the same section serves both, so the subtitle follows the
                data rather than the ambition. */}
            <p className="section-subtitle">
              {neighborhoodsHaveEvents
                ? `Events happening all across ${city.name}, every week.`
                : `The areas Smileys covers in ${city.name} — see who's around and what's starting.`}
            </p>
          </div>
          <a href={enter('neighborhoods')} className="hidden md:flex btn-ghost text-sm items-center gap-1">All neighborhoods →</a>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {topNeighborhoods.map(n => (
            <a key={n.slug} href={enter('neighborhoods', n.slug)}
              className="group flex flex-col items-center text-center gap-2 bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-amber-200 hover:-translate-y-0.5 transition-all duration-200">
              <span className="text-3xl">{n.emoji}</span>
              <span className="font-semibold text-sm text-gray-900 group-hover:text-amber-600 transition-colors leading-tight">{n.name}</span>
              {/* Event count where there are events; the neighborhood's own
                  vibe line otherwise. "0 events" on every card reads as a
                  dead city, and a city this young is the one that can least
                  afford that first impression. */}
              {n.eventCount > 0
                ? <span className="text-xs text-amber-600 font-semibold">{n.eventCount} event{n.eventCount !== 1 ? 's' : ''}</span>
                : n.vibe
                  ? <span className="text-xs text-gray-600 leading-snug">{n.vibe}</span>
                  : null}
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}
