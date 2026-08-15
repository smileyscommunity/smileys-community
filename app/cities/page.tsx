import type { Metadata } from 'next'
import Link from 'next/link'
import CityCard from '@/components/CityCard'
import { getPublicCities, CITY_STATUS } from '@/lib/cities'
import { APP_URL } from '@/lib/env'

// The city index — the one page that shows the whole network at once.
//
// It exists because everything else that listed cities was a dropdown or a
// section of the guest homepage, and members are redirected off that homepage
// to their dashboard. So the people most invested in where Smileys goes next
// had nowhere to see it. This is also what the bottom-nav Cities tab needs: a
// destination, not a menu.

export const metadata: Metadata = {
  title: 'Smileys cities — where we are, and where we\'re going next',
  description:
    'Every Smileys city: the communities that are live today and the ones opening next. One account works across all of them.',
  alternates: { canonical: `${APP_URL}/cities` },
}

export const revalidate = 60

export default async function CitiesPage() {
  const cities = await getPublicCities()
  const live   = cities.filter(c => c.status === CITY_STATUS.Live)
  const soon   = cities.filter(c => c.status !== CITY_STATUS.Live)

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
      <div className="mb-10">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-gray-900 mb-3">
          Smileys cities
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl leading-relaxed">
          Each city is its own local community — its own members, clubs, events and hosts.
          One account gets you into all of them, and it travels with you.
        </p>
      </div>

      {live.length > 0 && (
        <section className="mb-14">
          <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-5">
            Live {live.length > 1 && <span className="text-gray-400">· {live.length}</span>}
          </h2>
          <div className={`grid gap-6 ${live.length === 1 ? 'lg:grid-cols-2' : 'md:grid-cols-2 lg:grid-cols-3'}`}>
            {live.map((c, i) => <CityCard key={c.id} city={c} featured={live.length === 1 && i === 0} />)}
          </div>
        </section>
      )}

      {soon.length > 0 && (
        <section>
          <h2 className="text-sm font-bold uppercase tracking-widest text-gray-500 mb-5">On the way</h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {soon.map(c => <CityCard key={c.id} city={c} />)}
          </div>
        </section>
      )}

      {/* No invented dates and no invented cities — the same rule the homepage
          follows. A city appears here when it exists, not when it's hoped for. */}
      <p className="mt-12 text-sm text-gray-500">
        Somewhere you'd like to see Smileys?{' '}
        <Link href="/contact" className="font-semibold text-amber-600 hover:underline">Tell us where.</Link>
      </p>
    </div>
  )
}
