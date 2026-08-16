import type { Metadata } from 'next'
import Link from 'next/link'
import CityCard from '@/components/CityCard'
import { getPublicCities, CITY_STATUS } from '@/lib/cities'
import { getViewCityId } from '@/lib/city'
import { getSession } from '@/lib/session'
import { APP_URL } from '@/lib/env'
import { absoluteOgImage } from '@/lib/og'

// The city index — the one page that shows the whole network at once.
//
// It exists because everything else that listed cities was a dropdown or a
// section of the guest homepage, and members are redirected off that homepage
// to their dashboard. So the people most invested in where Smileys goes next
// had nowhere to see it. This is also what the bottom-nav Cities tab needs: a
// destination, not a menu.

// Built per request rather than as a static constant so the share image is a
// real city photo — a link to the city index that previews the generic card
// says nothing about what's behind it.
export async function generateMetadata(): Promise<Metadata> {
  const cities  = await getPublicCities()
  const ogImage = absoluteOgImage(cities.find(c => c.status === CITY_STATUS.Live)?.heroImage ?? cities[0]?.heroImage)
  const title   = 'Smileys cities — where we are, and where we\'re going next'
  const description =
    'Every Smileys city: the communities that are live today and the ones opening next. One account works across all of them.'

  return {
    title,
    description,
    alternates: { canonical: `${APP_URL}/cities` },
    openGraph: {
      title, description, url: `${APP_URL}/cities`,
      ...(ogImage ? { images: [{ url: ogImage, width: 1200, height: 630, alt: 'Smileys cities' }] } : {}),
    },
    ...(ogImage ? { twitter: { card: 'summary_large_image' as const, images: [ogImage] } } : {}),
  }
}

// Was `revalidate = 60`. Reading the viewer's city makes the page per-request,
// which is the price of it answering "which city am I in?" — the only place a
// member on a phone can ask. The city data underneath is still cached, so this
// costs a cookie read and a slug lookup, not a rebuild of the page's queries.
export const dynamic = 'force-dynamic'

export default async function CitiesPage() {
  const [cities, session, viewCityId] = await Promise.all([
    getPublicCities(), getSession(), getViewCityId(),
  ])
  const live   = cities.filter(c => c.status === CITY_STATUS.Live)
  const soon   = cities.filter(c => c.status !== CITY_STATUS.Live)

  // Same precedence the nav menu uses: the cookie if it's set, otherwise your
  // home city. Guests have neither and see the plain list.
  const homeId    = session?.cityId
  const viewingId = viewCityId ?? homeId

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
            {live.map((c, i) => (
              <CityCard key={c.id} city={c} featured={live.length === 1 && i === 0}
                viewing={!!viewingId && c.id === viewingId} home={!!homeId && c.id === homeId} />
            ))}
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
