import Image from 'next/image'
import Link from 'next/link'
import { cityQs } from '@/lib/cityPageParam'
import type { CityHandbookPick } from '@/lib/cityHandbookPicks'
import type { PublicCity, EnterLink } from '../data'

// The city's own Handbook articles (lib/cityHandbookPicks), as small cards
// under the buttons. The section used to offer only "The <city> Handbook", so
// the one guide written for this city — its transport card — was two clicks
// away and unnamed. Hidden when the city has none yet.
function HandbookPicks({ city, picks }: { city: PublicCity; picks: CityHandbookPick[] }) {
  if (picks.length === 0) return null
  return (
    <div className="mt-8">
      <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">Start here</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {picks.map(p => (
          <Link key={p.slug} href={`/handbook/${p.slug}${cityQs(city.slug)}`} className="group card overflow-hidden bg-white hover:-translate-y-0.5 transition-transform duration-300">
            {p.cover && (
              <div className="relative aspect-[16/9]">
                <Image src={p.cover} alt="" fill sizes="(max-width: 640px) 100vw, 33vw" className="object-cover" />
              </div>
            )}
            <div className="p-4">
              <h3 className="font-bold text-gray-900 text-sm leading-snug group-hover:text-amber-600 transition-colors line-clamp-2">{p.title}</h3>
              {p.excerpt && <p className="mt-1 text-xs text-gray-600 leading-relaxed line-clamp-2">{p.excerpt}</p>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

// The moving, remote-work and student hubs gather this section's practical links into
// arrival paths; text links rather than more buttons. Only live cities render this
// section, and every live city has a hub.
function RemoteWorkLink({ city }: { city: PublicCity }) {
  return (
    <div className="mt-6 flex flex-col sm:flex-row gap-x-6 gap-y-2 text-sm font-bold">
      <Link href={`/${city.slug}/moving`} className="text-amber-700 hover:text-amber-800">
        Moving to {city.name}? Start here <span aria-hidden="true">→</span>
      </Link>
      <Link href={`/${city.slug}/remote-work`} className="text-amber-700 hover:text-amber-800">
        Working remotely? Your first 72 hours <span aria-hidden="true">→</span>
      </Link>
      <Link href={`/${city.slug}/students`} className="text-amber-700 hover:text-amber-800">
        International student? Your first week <span aria-hidden="true">→</span>
      </Link>
    </div>
  )
}

// Shown when the city HAS a guide, not when it is the default city. The old
// gate was written when /guide could only ever serve the default city's
// entries, so offering "the <city> guide" anywhere else would have handed the
// reader someone else's content — worse than no link. Both halves of that
// are now false: the guide reads per city, and the second city has a dozen
// entries of its own. All the gate still did was hide a real guide from the
// city it belongs to.
//
// Counting entries rather than naming a city also keeps it honest for city
// #3, which has none on day one and shouldn't be offered an empty guide.
export default function Guide({ city, hasGuide, enter, handbookPicks }: { city: PublicCity; hasGuide: boolean; enter: EnterLink; handbookPicks: CityHandbookPick[] }) {
  if (hasGuide) {
    return (
      <section className="py-12 sm:py-16 bg-white border-t border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl bg-gradient-to-br from-amber-50 to-white border border-amber-100 p-8 sm:p-12">
            <h2 className="section-title">Get to know <span className="text-amber-600">{city.name}</span></h2>
            <p className="section-subtitle max-w-2xl mb-8">
              Neighborhoods, where to go, things to do, coworking, nightlife and the local tips
              that take newcomers months to work out.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              {/* Through the city-enter endpoint, which sets the view city before
                  landing: /guide reads the viewer's city, so a plain link would
                  show a cookie-less visitor the founding city's guide from another city's page. */}
              <a href={enter('guide')} className="btn-primary">Read the {city.name} guide</a>
              {/* The Handbook (how the city works: transport cards, permits,
                  banking) is the practical sibling of the guide — the four
                  national articles apply to every city from day one, so this
                  link never lands on an empty shelf. */}
              <a href={enter('handbook')} className="btn-secondary">The {city.name} Handbook</a>
              <a href={enter('directory')} className="btn-secondary">Browse places</a>
            </div>
            <HandbookPicks city={city} picks={handbookPicks} />
            <RemoteWorkLink city={city} />
          </div>
        </div>
      </section>
    )
  }
  // No guide entries yet (city #3 on day one) — but the Handbook's national
  // articles apply everywhere from day one, so that link must not disappear
  // with the guide. Same visual language, minus the guide button, with the
  // handbook promoted to the primary slot.
  return (
    <section className="py-12 sm:py-16 bg-white border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="rounded-3xl bg-gradient-to-br from-amber-50 to-white border border-amber-100 p-8 sm:p-12">
          <h2 className="section-title">Get to know <span className="text-amber-600">{city.name}</span></h2>
          <p className="section-subtitle max-w-2xl mb-8">
            How the city works: transport cards, permits, banking and the practical
            tips that take newcomers months to work out.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <a href={enter('handbook')} className="btn-primary">The {city.name} Handbook</a>
            <a href={enter('directory')} className="btn-secondary">Browse places</a>
          </div>
          <HandbookPicks city={city} picks={handbookPicks} />
          <RemoteWorkLink city={city} />
        </div>
      </div>
    </section>
  )
}
