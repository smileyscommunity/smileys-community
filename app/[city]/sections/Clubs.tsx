import Link from 'next/link'
import ClubCard from '@/components/ClubCard'
import type { PublicCity, CityPageData, EnterLink } from '../data'

// Same rule as events: an empty grid becomes a host invitation.
export default function Clubs({ city, featuredClubs, enter }: { city: PublicCity; featuredClubs: CityPageData['clubs']; enter: EnterLink }) {
  if (featuredClubs.length === 0) {
    return (
      <section className="py-12 sm:py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-gray-100 bg-gray-50 p-8 sm:p-12 text-center">
            <h2 className="section-title mb-2">Clubs are forming</h2>
            <p className="text-gray-600 mb-6 max-w-xl mx-auto">
              Have an activity you want to organize in {city.name}? The first clubs are started by members like you.
            </p>
            <Link href="/get-involved" className="btn-primary inline-flex">Become a host</Link>
          </div>
        </div>
      </section>
    )
  }
  return (
    <section className="py-12 sm:py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="section-title">Find your people</h2>
            <p className="section-subtitle">Every interest covered — join as many as you like.</p>
          </div>
          <a href={enter('clubs')} className="hidden md:flex btn-ghost text-sm items-center gap-1">All clubs →</a>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {featuredClubs.map(club => <ClubCard key={club.id} club={club} hideEmptyNextEvent />)}
        </div>
        <div className="text-center mt-10 md:hidden">
          <a href={enter('clubs')} className="btn-secondary">All clubs</a>
        </div>
      </div>
    </section>
  )
}
