import Image from 'next/image'
import Link from 'next/link'
import CityPageTracker from '@/components/CityPageTracker'
import JoinCityButton from '@/components/JoinCityButton'
import { resolveImageUrl } from '@/lib/data'
import { CITY_STATUS } from '@/lib/cityStatus'
import type { PublicCity } from '../data'

// A city that isn't live has no events, clubs or members to show. Rather
// than render a page full of empty sections, it gets a holding page — the
// same rule the city cards follow.
export default function PreLaunch({ city }: { city: PublicCity }) {
  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
      <CityPageTracker slug={city.slug} status={city.status} />
      {/* The city's own photo, if one is set. A pre-launch page is a pitch —
          "this is where we're going next" lands far better with the place in
          front of you than with a paragraph of text. */}
      {city.heroImage && (
        <div className="relative aspect-[16/9] rounded-2xl overflow-hidden shadow-xl mb-10">
          <Image
            src={resolveImageUrl(city.heroImage)}
            alt={city.name}
            fill priority
            sizes="(max-width: 768px) calc(100vw - 32px), 768px"
            className="object-cover"
          />
        </div>
      )}
      <span className="inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold uppercase tracking-widest mb-6">
        {city.status === CITY_STATUS.Preparing ? 'Preparing' : 'Coming soon'}
      </span>
      <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 mb-5">
        {/* The city's own name carries the brand amber in every heading on
            this page — amber-600 rather than the brand's amber-500, which is
            a button fill and clears only ~2.1:1 on white. Matches the
            handbook's city heading. */}
        Smileys is coming to <span className="text-amber-600">{city.name}.</span>
      </h1>
      <p className="text-lg text-gray-600 leading-relaxed mb-10">
        {city.description ?? `We're building the ${city.name} community now — founding members, hosts and the first clubs. Join the list and you'll be among the first in.`}
      </p>
      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <JoinCityButton slug={city.slug} name={city.name} live={false} />
        <Link href="/cities" className="btn-secondary text-base px-8 py-4">See our live cities</Link>
      </div>
    </section>
  )
}
