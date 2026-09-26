import Link from 'next/link'
import EventCard from '@/components/EventCard'
import JoinCityButton from '@/components/JoinCityButton'
import type { Event } from '@/lib/data'

// What a city with no experiences on its calendar shows instead of a dead
// end. Every city but the founding one landed here from a public nav link
// and got "Nothing scheduled right now" and nothing else. Now: the honest
// line about why, then the city's next events if it has any — the same
// cards as its events hub — or the founding-member ask if it has none.

interface Props {
  city:       { slug: string; name: string; timezone: string }
  events:     Event[]        // already redacted / projected for this viewer
  eventsHref: string
}

export default function NothingYet({ city, events, eventsHref }: Props) {
  return (
    <div className="space-y-10">
      <div className="rounded-3xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white p-8 sm:p-10 text-center">
        <span aria-hidden="true" className="text-4xl block mb-3">✨</span>
        <p className="font-bold text-gray-900 text-lg mb-2">No experiences on the {city.name} calendar yet</p>
        <p className="text-sm text-gray-600 max-w-xl mx-auto">
          An experience is an event a host tags as one — a hike, a sailing trip, a workshop,
          a night at the theatre. The first one in {city.name} appears here the day it is scheduled.
        </p>
        {events.length === 0 && (
          <div className="flex justify-center mt-6">
            <JoinCityButton slug={city.slug} name={city.name} />
          </div>
        )}
      </div>

      {events.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between gap-4 mb-4">
            <h2 className="text-xl font-extrabold tracking-tight text-gray-900">Meanwhile, what&apos;s on in {city.name}</h2>
            <Link href={eventsHref} className="text-sm font-bold text-amber-700 hover:underline shrink-0">All events →</Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* The city's own clock decides a card's started/ended state. */}
            {events.map(e => <EventCard key={e.id} event={e} timeZone={city.timezone} />)}
          </div>
        </section>
      )}
    </div>
  )
}
