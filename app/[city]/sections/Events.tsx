import EventTabs from '@/components/EventTabs'
import JoinCityButton from '@/components/JoinCityButton'
import type { Event } from '@/lib/data'
import type { PublicCity } from '../data'

type Window = Parameters<typeof EventTabs>[0]['window']

// A live city with none yet gets an invitation, not a missing section
// (§30: never look broken, communicate opportunity).
export default function Events({ city, tabEvents, eventWindow }: { city: PublicCity; tabEvents: Event[]; eventWindow: Window }) {
  if (tabEvents.length === 0) {
    return (
      <section className="py-12 sm:py-16 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-8 sm:p-12 text-center">
            <h2 className="section-title mb-2">Events are coming soon</h2>
            <p className="text-gray-600 mb-6 max-w-xl mx-auto">
              Be one of the first to help build Smileys {city.name} — the first dinners, walks and meetups start with the first members.
            </p>
            <div className="flex justify-center">
              <JoinCityButton slug={city.slug} name={city.name} />
            </div>
          </div>
        </div>
      </section>
    )
  }
  return (
    <section className="py-12 sm:py-16 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h2 className="section-title">What's happening in <span className="text-amber-600">{city.name}</span></h2>
          <p className="section-subtitle">Pick a day and see what's on.</p>
        </div>
        <EventTabs events={tabEvents} window={eventWindow} />
      </div>
    </section>
  )
}
