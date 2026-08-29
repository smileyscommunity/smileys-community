'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { searchHandbook, type HandbookSearchItem } from '@/lib/handbook-search'

// The Handbook homepage's dominant action: "what do you need help with?".
// Search runs client-side over the index the server passes down — the corpus
// is small, so results appear as the member types, with no API round-trip
// (see lib/handbook-search for the matching semantics and the scale note).
//
// The empty state matters as much as the results: a failed search ends with
// "Ask the community", not a dead end — the Board is where questions the
// Handbook can't answer yet are supposed to go.

// Suggestion chips double as example queries (what CAN I search for?) and as
// one-tap searches on mobile. The Handbook is per-city now, so "hits today's
// corpus" is enforced rather than hoped: each candidate is run against the
// index this city actually passed down, and a chip that would land on the
// empty state never renders — Istanbulkart doesn't appear on İzmir's
// handbook, İzmirim Kart doesn't appear on Istanbul's.
const CHIP_CANDIDATES = ['Istanbulkart', 'İzmirim Kart', 'Residence permit', 'Bank account', 'Doctor', 'Rent', 'Scams']

export default function HandbookSearch({ items }: { items: HandbookSearchItem[] }) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => searchHandbook(items, query), [items, query])
  const suggestions = useMemo(() => CHIP_CANDIDATES.filter(s => searchHandbook(items, s).length > 0), [items])
  const showEmpty = query.trim().length > 0 && results.length === 0

  return (
    <div>
      <label htmlFor="handbook-search" className="sr-only">Search the Handbook</label>
      <div className="relative">
        <span aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-lg">🔍</span>
        <input
          id="handbook-search"
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search the Handbook — try “ikamet”, “bank account”, “eczane”…"
          autoComplete="off"
          className="w-full pl-11 pr-4 py-3.5 rounded-2xl border border-gray-200 bg-white text-sm sm:text-base text-gray-900 placeholder:text-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-300"
        />
      </div>

      {/* Chips stay visible while typing so a dead-end query has an obvious
          recovery path one tap away. */}
      <div className="flex flex-wrap gap-1.5 mt-3">
        {suggestions.map(s => (
          <button key={s} type="button" onClick={() => setQuery(s)}
            className="px-3 py-1 rounded-full bg-gray-100 hover:bg-amber-100 text-xs font-semibold text-gray-600 hover:text-amber-700 transition-colors">
            {s}
          </button>
        ))}
      </div>

      {results.length > 0 && (
        <ul className="mt-4 space-y-2">
          {results.map(r => (
            <li key={r.slug}>
              <Link href={`/handbook/${r.slug}`}
                className="block bg-white border border-gray-200 rounded-xl px-4 py-3 hover:border-amber-300 hover:shadow-sm transition-all group">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                  <span aria-hidden="true">{r.emoji}</span>
                  <span className="font-semibold">{r.category}</span>
                  <span>· {r.minutes} min read</span>
                  {/* Reviewed line only when a review actually happened. */}
                  {r.reviewed && <span className="hidden sm:inline">· {r.reviewed}</span>}
                </div>
                <p className="text-sm font-extrabold text-gray-900 group-hover:text-amber-600 transition-colors leading-tight">
                  {r.title}
                </p>
                {r.excerpt && <p className="text-xs text-gray-600 mt-1 line-clamp-1">{r.excerpt}</p>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {showEmpty && (
        <div className="mt-4 bg-gray-50 border border-gray-200 rounded-xl px-4 py-4 text-center">
          <p className="text-sm font-bold text-gray-900 mb-1">We couldn’t find that.</p>
          <p className="text-xs text-gray-600 mb-3">Try one of the suggestions above — or ask people who’ve been through it.</p>
          <Link href="/board" className="inline-block text-xs font-bold text-amber-600 hover:text-amber-700">
            Ask the community on the Board →
          </Link>
        </div>
      )}
    </div>
  )
}
