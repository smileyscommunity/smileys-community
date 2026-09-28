import Image from 'next/image'
import Link from 'next/link'
import { resolveImageUrl } from '@/lib/data'
import { cityQs } from '@/lib/cityPageParam'
import type { CityPageData, PublicCity } from '../data'

// The homepage's card treatment, not a text strip: on the shopfront these
// ARE the social proof, and for a city too young for member quotes they're
// the only voice the page has. The city's own pieces lead (see the sort in
// getCityPageData); self-hiding when nothing is relevant yet.
//
// Ahead of the pull-quotes on purpose: a written piece with a photo carries
// further than a one-line quote, and a founding city usually has stories
// before it has quotes — so the section that can actually speak for it
// comes first.
export default function Stories({ city, latestStories }: { city: PublicCity; latestStories: CityPageData['latestStories'] }) {
  if (latestStories.length === 0) return null
  // A young city's strip is Smileys-wide pieces (how free spots work, the
  // Cup recap), so it does not claim to be the city's own writing.
  const hasOwn = latestStories.some(p => p.cityId === city.id)
  return (
    <section className="py-12 sm:py-16 bg-white border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h2 className="section-title">Stories from Smileys</h2>
            <p className="section-subtitle">{hasOwn ? `Real writing from the ${city.name} community.` : 'From across Smileys — the first stories from here are still to be written.'}</p>
          </div>
          <Link href={`/posts${cityQs(city.slug)}`} className="text-sm font-bold text-amber-600 hover:underline shrink-0">All stories →</Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {latestStories.map(p => (
            <Link key={p.id} href={`/posts/${p.slug}`} className="group card overflow-hidden hover:-translate-y-1 transition-transform duration-300">
              {p.coverImage && (
                <div className="relative aspect-[16/9]">
                  <Image src={resolveImageUrl(p.coverImage)} alt="" fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" />
                </div>
              )}
              <div className="p-5">
                <h3 className="font-bold text-gray-900 mb-1.5 group-hover:text-amber-600 transition-colors line-clamp-2">{p.title}</h3>
                {p.excerpt && <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">{p.excerpt}</p>}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
