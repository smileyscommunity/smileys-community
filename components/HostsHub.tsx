import Link from 'next/link'
import { cityQs } from '@/lib/cityPageParam'
import { rosterSummary, type RosterHost } from '@/lib/hostTitles'
import HostRosterCard from '@/components/HostRosterCard'
import HostPath from '@/components/HostPath'

// Meet the Hosts, the page itself — rendered by /hosts (the viewer's city)
// and /[city]/hosts (a fixed city) so the two are one product: the same
// hero, count line, roster, path and closing CTA. They had drifted apart
// (one had no city in its heading and an empty state without a button),
// and the default city got the weaker one at its canonical URL.
export default function HostsHub({ city, hosts, signedIn }: {
  city: { slug: string; name: string }
  hosts: RosterHost[]
  signedIn: boolean
}) {
  const leads = hosts.filter(h => h.title === 'lead').length
  const involved = `/get-involved${cityQs(city.slug)}`

  return (
    <>
      <section className="bg-gradient-to-b from-amber-50 via-white to-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-8">
          <Link href={`/${city.slug}`} className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-amber-700 hover:text-amber-800 mb-6">
            <span aria-hidden="true">←</span> Smileys {city.name}
          </Link>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 mb-3">
            Meet the Hosts in <span className="text-amber-600">{city.name}</span>
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl">
            {rosterSummary(hosts.length, leads, city.name)}
          </p>
        </div>
      </section>

      <section className="py-10 sm:py-14 bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {hosts.length === 0 ? (
            <div className="rounded-3xl border border-gray-100 bg-gray-50 p-8 sm:p-12 text-center">
              <h2 className="section-title mb-2">No hosts here yet</h2>
              <p className="text-gray-600 mb-6 max-w-xl mx-auto">
                Every city starts with one person who decides to host the first thing. In {city.name}, that could be you.
              </p>
              <Link href={involved} className="btn-primary inline-flex">Become a host</Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* A guest's rows carry no id and a first name, so two hosts
                  called Ali would share a key; the position is stable
                  (rankHosts) and unique. */}
              {hosts.map((h, i) => <HostRosterCard key={h.id || `${h.name}-${i}`} host={h} signedIn={signedIn} citySlug={city.slug} />)}
            </div>
          )}

          <HostPath cityName={city.name} className="mt-12" />

          <div className="mt-8 bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl p-8 text-center text-white">
            <h2 className="text-2xl font-extrabold mb-2">Could you be a host?</h2>
            <p className="text-amber-50 max-w-xl mx-auto mb-6">
              Hosts get support, visibility and the best seat in the house: watching people you
              brought together become friends. No experience needed — just care.
            </p>
            <Link href={involved}
              className="inline-flex items-center gap-2 bg-white text-amber-700 font-bold px-8 py-3.5 rounded-xl hover:bg-amber-50 transition-colors">
              Become a host
              <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
