import Link from 'next/link'
import JoinCityButton from '@/components/JoinCityButton'
import { CITY_MATURITY } from '@/lib/cityMaturity'
import CityHeroImage from './CityHeroImage'
import type { PublicCity, EnterLink } from '../data'

export default function Hero({ city, enter }: { city: PublicCity; enter: EnterLink }) {
  const stats = city.stats
  return (
    <section className="relative bg-gradient-to-b from-amber-50 via-white to-white overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(251,191,36,0.15),transparent)]" />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 relative">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <div>
            <Link href="/cities" className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-amber-700 hover:text-amber-800 mb-6">
              <span aria-hidden="true">←</span> All Smileys cities
            </Link>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-gray-900 leading-[1.08] mb-6">
              Find your people in <span className="text-amber-600">{city.name}.</span>
            </h1>

            <p className="text-lg md:text-xl text-gray-600 max-w-2xl leading-relaxed mb-10">
              {city.description ?? `From social dinners to weekend trips and neighborhood clubs, Smileys brings people together in ${city.name} through curated experiences and lasting friendships.`}
            </p>

            <div className="lg:hidden relative aspect-[3/2] rounded-2xl overflow-hidden shadow-xl mb-10">
              <CityHeroImage city={city} sizes="(max-width: 639px) calc(100vw - 32px), calc(100vw - 48px)" />
            </div>

            <div className="flex flex-col sm:flex-row gap-4 mb-3">
              {/* Signed-in members get a one-tap join (their account already
                  exists — see components/JoinCityButton); guests fall through
                  to the application flow below. */}
              <JoinCityButton slug={city.slug} name={city.name} />
              <a href={enter('events')} className="btn-secondary text-base px-8 py-4">See what's on</a>
            </div>
            <p className="text-sm font-medium text-gray-700 mb-12">
              Free to join · Applications reviewed by hand within 24 hours · Pay only for events you attend
            </p>

            {/* Seeding = live but empty; "1 / 11 / 1" in hero type reads as
                a dead community, not a young one. Stage-honest copy instead —
                derived (lib/cityMaturity), so it flips back to real numbers
                by itself the moment the city earns them. */}
            {stats && (stats.maturity === CITY_MATURITY.Seeding ? (
              <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-5 py-4">
                <p className="text-sm font-bold text-amber-800 uppercase tracking-wider mb-1">Founding stage</p>
                <p className="text-gray-700">
                  {stats.clubs > 0
                    ? <>{stats.clubs} club{stats.clubs === 1 ? '' : 's'} forming and the first events going on the calendar — the founding members shape everything here.</>
                    : <>The first clubs and events are being set up now — the founding members shape everything here.</>}
                </p>
                {/* The scarcity that's actually true: joining now carries a
                    rank, and the rank is permanent (users.foundingMember). */}
                <p className="mt-1.5 text-sm font-semibold text-amber-800">
                  Join now and you're founding member #{stats.members + 1}.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-x-6">
                {[
                  { value: stats.members, label: 'Members' },
                  { value: stats.clubs,   label: 'Clubs' },
                  // "Upcoming events" wraps in a ~110px column on a 375px
                  // phone; "Upcoming" is what the homepage city card says too.
                  { value: stats.events,  label: 'Upcoming' },
                ].map(s => (
                  <div key={s.label}>
                    <div className="text-2xl md:text-3xl font-extrabold text-gray-900 tracking-tight tabular-nums">
                      {s.value.toLocaleString('en-US')}
                    </div>
                    <div className="text-xs text-gray-600 mt-1 uppercase tracking-wider font-medium">{s.label}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="hidden lg:block relative h-[500px] rounded-2xl overflow-hidden shadow-xl">
            <CityHeroImage city={city} sizes="(max-width: 1024px) 0px, (max-width: 1344px) calc(50vw - 64px), 576px" />
          </div>
        </div>
      </div>
    </section>
  )
}
