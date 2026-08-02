'use client'

import { useState } from 'react'
import Link from 'next/link'
import { resolveImageUrl } from '@/lib/data'

export interface LocalPick {
  id:           string
  name:         string
  category:     string
  neighborhood: string | null
  coverImage:   string | null
  reviewCount:  number
  quote:        string | null
  quoteBy:      string | null
}

// The brief lists six tabs (Coffee/Eat/Drinks/Work/Music/Outdoors) but the
// directory only carries Cafe, Restaurant, Bar and a few service categories
// — half those tabs would open onto nothing. Tabs are therefore derived from
// categories that actually have listings, with friendly labels where one
// exists and the raw category otherwise.
const CATEGORY_LABEL: Record<string, string> = {
  Cafe:       '☕ Coffee',
  Restaurant: '🍽️ Eat',
  Bar:        '🍸 Drinks',
  Health:     '🌿 Wellness',
  Services:   '💼 Services',
  Other:      '✨ More',
}

export default function LocalFavorites({ picks }: { picks: LocalPick[] }) {
  const categories = [...new Set(picks.map(p => p.category))]
    .sort((a, b) => picks.filter(p => p.category === b).length - picks.filter(p => p.category === a).length)

  const [active, setActive] = useState<string | null>(null)
  const shown = (active ? picks.filter(p => p.category === active) : picks).slice(0, 6)

  if (picks.length === 0) return null

  return (
    <section className="mb-12">
      <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900">Loved by locals</h2>
      <p className="text-gray-600 mt-1.5 mb-5">Places Smileys members actually recommend.</p>

      <div className="flex gap-2 flex-wrap mb-6">
        <button onClick={() => setActive(null)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
            active === null ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
          }`}>
          All
        </button>
        {categories.map(cat => (
          <button key={cat} onClick={() => setActive(active === cat ? null : cat)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              active === cat ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
            }`}>
            {CATEGORY_LABEL[cat] ?? cat}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {shown.map(p => (
          <Link key={p.id} href={`/directory/${p.id}`}
            className="group bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md hover:border-amber-200 transition-all">
            {p.coverImage && (
              /* Directory covers are member uploads served through the files
                 route, so next/image isn't in play here — plain img keeps the
                 existing resolveImageUrl behaviour. */
              // eslint-disable-next-line @next/next/no-img-element
              <img src={resolveImageUrl(p.coverImage)} alt={p.name}
                className="w-full h-36 object-cover" loading="lazy" />
            )}
            <div className="p-4">
              <h3 className="font-bold text-gray-900 leading-snug group-hover:text-amber-700 transition-colors">{p.name}</h3>
              {p.neighborhood && (
                <p className="text-xs text-gray-500 mt-1"><span aria-hidden="true">📍 </span>{p.neighborhood}</p>
              )}
              {/* Only shown when real reviews exist — the brief's metric is
                  "recommended by Smileys members", not a star average. */}
              {p.reviewCount > 0 && (
                <p className="text-xs font-semibold text-amber-700 mt-1.5">
                  <span aria-hidden="true">❤️ </span>
                  Recommended by {p.reviewCount} Smiley{p.reviewCount !== 1 ? 's' : ''}
                </p>
              )}
              {p.quote && (
                <p className="text-xs text-gray-600 italic mt-2.5 leading-relaxed line-clamp-3">
                  “{p.quote}”{p.quoteBy && <span className="not-italic text-gray-400"> — {p.quoteBy.split(' ')[0]}</span>}
                </p>
              )}
              <span className="inline-block text-xs font-bold text-gray-700 mt-3 group-hover:text-amber-600 transition-colors">
                View recommendation →
              </span>
            </div>
          </Link>
        ))}
      </div>

      <Link href="/directory" className="inline-block mt-6 text-sm font-bold text-amber-600 hover:underline">
        See all local picks →
      </Link>
    </section>
  )
}
