import type { PublicCity, EnterLink } from '../data'

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
export default function Guide({ city, hasGuide, enter }: { city: PublicCity; hasGuide: boolean; enter: EnterLink }) {
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
        </div>
      </div>
    </section>
  )
}
