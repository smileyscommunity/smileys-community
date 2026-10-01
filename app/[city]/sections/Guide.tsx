import Link from 'next/link'
import Image from 'next/image'
import HandbookPicks from '@/components/HandbookPicks'
import type { CityHandbookPick } from '@/lib/cityHandbookPicks'
import type { PublicCity, EnterLink, GuidePick } from '../data'

// The guide's own entries, as cards — the section used to be three buttons
// and a promise. Plain links to /guide/<slug>: the detail page resolves its
// city from the slug and is canonical there, so no ?city= is needed and a
// crawler reaches every card. Emoji gradient when the entry has no photo,
// which is most cities today; same fallback as the guide's explorer.
function GuidePicks({ city, picks }: { city: PublicCity; picks: GuidePick[] }) {
  if (picks.length === 0) return null
  return (
    <div className="mb-8">
      <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">Your first weeks in {city.name}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Three on a phone — six stacked full-width cards pushed the rest
            of the page a long scroll away; the full guide is one tap below. */}
        {picks.map((p, i) => (
          <Link key={p.slug} href={`/guide/${p.slug}`}
            className={`group bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md hover:border-amber-200 hover:-translate-y-0.5 transition-all overflow-hidden flex-col ${i >= 3 ? 'hidden sm:flex' : 'flex'}`}>
            {p.photo ? (
              <div className="relative h-32 overflow-hidden">
                <Image src={p.photo} alt="" fill
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  className="object-cover group-hover:scale-105 transition-transform duration-300" />
              </div>
            ) : (
              <div className="h-24 bg-gradient-to-br from-amber-100 via-orange-50 to-amber-50 flex items-center justify-center">
                <span aria-hidden="true" className="text-5xl group-hover:scale-110 transition-transform">{p.emoji}</span>
              </div>
            )}
            <div className="p-5 flex-1 flex flex-col">
              <h3 className="font-bold text-gray-900 leading-snug group-hover:text-amber-700 transition-colors">{p.title}</h3>
              <p className="text-sm text-gray-600 mt-1.5 flex-1">{p.tagline}</p>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {[p.cost, p.time].filter(Boolean).map(chip => (
                  <span key={chip} className="text-[11px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5">
                    {chip}
                  </span>
                ))}
              </div>
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
export default function Guide({ city, hasGuide, enter, handbookPicks, guidePicks }: { city: PublicCity; hasGuide: boolean; enter: EnterLink; handbookPicks: CityHandbookPick[]; guidePicks: GuidePick[] }) {
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
            <GuidePicks city={city} picks={guidePicks} />
            <div className="flex flex-col sm:flex-row gap-4">
              {/* Through the city-enter endpoint, which sets the view city before
                  landing: /guide reads the viewer's city, so a plain link would
                  show a cookie-less visitor the founding city's guide from another city's page. */}
              <a href={enter('guide')} className="btn-primary">See the full {city.name} guide</a>
              {/* The Handbook (how the city works: transport cards, permits,
                  banking) is the practical sibling of the guide — the four
                  national articles apply to every city from day one, so this
                  link never lands on an empty shelf. */}
              <a href={enter('handbook')} className="btn-secondary">The {city.name} Handbook</a>
              <a href={enter('directory')} className="btn-secondary">Browse places</a>
            </div>
            <HandbookPicks citySlug={city.slug} picks={handbookPicks} className="mt-8" />
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
          <HandbookPicks citySlug={city.slug} picks={handbookPicks} className="mt-8" />
          <RemoteWorkLink city={city} />
        </div>
      </div>
    </section>
  )
}
