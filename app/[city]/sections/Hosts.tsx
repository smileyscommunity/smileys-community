import Link from 'next/link'
import { cityQs } from '@/lib/cityPageParam'
import HostRosterCard from '@/components/HostRosterCard'
import { HOST_TITLE } from '@/lib/hostTitles'
import { hubPath } from '../data'
import type { PublicCity, CityHosts } from '../data'

// Meet your hosts — the people behind the clubs above, with the title each
// one holds. Renders even when empty for a LIVE city: a city with no hosts
// yet is exactly the one that needs the seat advertised (the recruiting
// point of visible titles — see lib/hostTitles).
export default function Hosts({ city, hosts, hostTotal, signedIn }: {
  city: PublicCity; hosts: CityHosts['hosts']; hostTotal: number; signedIn: boolean
}) {
  const hasLead = hosts.some(h => h.title === 'lead')
  return (
    <section className="py-12 sm:py-16 bg-warm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-8 gap-4">
          <div>
            <h2 className="section-title">Meet your <span className="text-amber-600">hosts</span></h2>
            <p className="section-subtitle max-w-2xl">
              {hosts.length === 0
                ? `${city.name} is looking for its first hosts. Start a club, and the ${HOST_TITLE.lead} seat is open.`
                : hasLead
                  ? `The members who run ${city.name}’s clubs and lead the city. Hosts who keep the calendar alive become ${HOST_TITLE.lead}s.`
                  : `The members who run ${city.name}’s clubs. Nobody leads ${city.name} yet — a host who keeps its calendar alive can.`}
            </p>
          </div>
          {hostTotal > hosts.length && (
            <Link href={hubPath(city.slug, 'hosts')} className="hidden md:flex btn-ghost text-sm items-center gap-1 shrink-0">
              All {hostTotal} hosts →
            </Link>
          )}
        </div>
        {hosts.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {hosts.map((h, i) => <HostRosterCard key={h.id || `${h.name}-${i}`} host={h} signedIn={signedIn} citySlug={city.slug} compact />)}
          </div>
        )}
        <div className="flex items-center gap-4 flex-wrap">
          <Link href={`/get-involved${cityQs(city.slug)}`} className="btn-primary px-6 py-3">
            {hosts.length === 0 ? `Host the first thing in ${city.name}` : 'Become a host'}
          </Link>
          <Link href={hubPath(city.slug, 'hosts')} className="text-sm font-bold text-amber-600 hover:underline">
            {hostTotal > hosts.length ? `See all ${hostTotal} hosts →` : 'How hosting works →'}
          </Link>
        </div>
      </div>
    </section>
  )
}
