import { getSession } from '@/lib/session'
import { resolveCityId, getCityConfig } from '@/lib/city'
import ExploreMore from '@/components/ExploreMore'
import DirectoryClient from './DirectoryClient'

// Server wrapper around the client-side directory browser (./DirectoryClient,
// renamed from this file). It exists to resolve the viewer's city and append
// the shared ExploreMore cross-link grid, which needs the DB and so can't
// live inside the client tree. City resolution matches what the client's own
// data does: GET /api/directory scopes with resolveCityId (view-city cookie →
// member's home city → default), so the grid's counts follow the same city as
// the listings above it. Metadata stays in ../directory/layout.tsx.
export default async function DirectoryPage() {
  const cityId = await resolveCityId(await getSession())
  const city   = await getCityConfig(cityId)

  return (
    <div className="bg-warm pb-20 md:pb-0">
      <DirectoryClient />
      {/* Cross-links — the shared surface grid (components/ExploreMore),
          inside the directory's own max-w-7xl container convention. */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <ExploreMore current="directory" cityId={cityId} cityName={city.name} />
      </div>
    </div>
  )
}
