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
      {/* Hero: same shape as /partner-with-us (eyebrow, big heading, one calm paragraph). */}
      <section className="bg-white border-b border-gray-100">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-14 sm:py-16 text-center">
          <Link href={`/${city.slug}`} className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-600 hover:text-amber-700 mb-4">
            <span aria-hidden="true">←</span> Smileys {city.name}
          </Link>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900 tracking-tight leading-tight mb-5">
            Meet the Hosts in <span className="text-amber-600">{city.name}</span>
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed max-w-2xl mx-auto">
            {rosterSummary(hosts.length, leads, city.name)}
          </p>
        </div>
      </section>

      <section className="py-14 bg-warm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          {hosts.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-white p-8 sm:p-12 text-center">
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

          <div className="mt-8 bg-white rounded-2xl border border-gray-100 p-6 sm:p-8 text-center">
            <h2 className="text-xl font-extrabold text-gray-900 mb-2">Could you be a host?</h2>
            <p className="text-sm text-gray-600 max-w-xl mx-auto mb-5">
              Hosts get support, visibility and the best seat in the house: watching people you
              brought together become friends. No experience needed — just care.
            </p>
            <Link href={involved}
              className="inline-flex items-center gap-2 px-7 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors">
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
