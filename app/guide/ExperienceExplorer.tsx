'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import posthog from 'posthog-js'
import { type Experience, type GuideMood, type GuideTaxon } from '@/lib/guide'

// §4 of the Guide plan — "What are you in the mood for?" chips filtering
// the experience grid client-side. Same interaction pattern as the
// Hangouts activity chips: exclusive toggle, tap again to clear.
// `moods` comes from the server page, which knows which city is being viewed —
// the chips are Bodrum's verbs on Bodrum's guide, Istanbul's on Istanbul's.
export default function ExperienceExplorer({ experiences, moods }: { experiences: Experience[]; moods: GuideTaxon[] }) {
  const [mood, setMood] = useState<GuideMood | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')

  // Default view is a handful of picks, NOT the whole catalog — the
  // collection shelves below already list everything, and rendering all
  // 15 here made the page repeat every experience. JSON order leads with
  // the flagships (the first-timer strip now lives on /visiting, so the
  // essentials belong in this grid again). Choosing a mood or searching
  // always covers everything.
  // Search (plan s20) covers the full set regardless of mood/collapse:
  // title, tagline, why, the Take, and mood labels all match.
  const q = query.trim().toLowerCase()

  // search_performed — debounced so we log search intents, not keystrokes.
  useEffect(() => {
    if (q.length < 3) return
    const t = setTimeout(() => posthog.capture('search_performed', { surface: 'guide', query: q }), 1200)
    return () => clearTimeout(t)
  }, [q])
  const searched = q
    ? experiences.filter(e =>
        [e.title, e.tagline, e.why, e.take, ...e.moods].join(' ').toLowerCase().includes(q))
    : null
  const filtered = searched
    ? (mood ? searched.filter(e => e.moods.includes(mood)) : searched)
    : mood
      ? experiences.filter(e => e.moods.includes(mood))
      : showAll
        ? experiences
        : experiences.slice(0, 6)

  return (
    <div>
      <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-gray-900 mb-1">
        What are you in the mood for?
      </h2>
      <p className="text-gray-600 mb-4">Pick a mood, search, or start with a few favorites.</p>

      <div className="relative mb-4 max-w-md">
        <svg aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input type="text" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="What do you want to experience? sunset, hammam, jazz…"
          className="w-full pl-9 pr-8 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition" />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"><span aria-hidden="true">×</span></button>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-3 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-hide" role="tablist" aria-label="Mood filter">
        {moods.map(m => (
          <button key={m.value} role="tab" aria-selected={mood === m.value}
            onClick={() => setMood(v => {
              const next = v === m.value ? null : m.value
              if (next) posthog.capture('mood_selected', { mood: next })
              return next
            })}
            className={`shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-sm font-bold border whitespace-nowrap transition-all ${
              mood === m.value
                ? 'bg-amber-500 border-amber-500 text-white shadow-sm'
                : 'bg-white border-gray-200 text-gray-700 hover:border-amber-300 hover:-translate-y-0.5'
            }`}>
            <span aria-hidden="true">{m.emoji}</span> {m.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-600 border border-dashed border-gray-200 rounded-2xl mt-3">
          Nothing matches that mood yet — more experiences are on the way.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-3">
          {filtered.map(e => (
            <Link key={e.slug} href={`/guide/${e.slug}`}
              className="group bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md hover:border-amber-200 hover:-translate-y-0.5 transition-all overflow-hidden flex flex-col">
              {/* Photo banner when the drop-in asset exists; emoji
                  gradient otherwise — same fallback approach as the
                  neighborhood cards. */}
              {e.photo ? (
                <div className="h-32 overflow-hidden">
                  <img src={e.photo} alt="" loading="lazy" decoding="async"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                </div>
              ) : (
                <div className="h-24 bg-gradient-to-br from-amber-100 via-orange-50 to-amber-50 flex items-center justify-center">
                  <span aria-hidden="true" className="text-5xl group-hover:scale-110 transition-transform">{e.emoji}</span>
                </div>
              )}
              <div className="p-5 flex-1 flex flex-col">
                <h3 className="font-bold text-gray-900 leading-snug group-hover:text-amber-700 transition-colors">
                  {e.title}
                </h3>
                <p className="text-sm text-gray-600 mt-1.5 flex-1">{e.tagline}</p>
                {/* Two meta chips only (§8: don't clutter cards) — the
                    "when" line lives on the detail page. */}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {[e.cost, e.time].map(chip => (
                    <span key={chip} className="text-[11px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5">
                      {chip}
                    </span>
                  ))}
                </div>
                <span className="inline-block text-xs font-bold text-amber-600 mt-3">Explore →</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {!q && !mood && !showAll && filtered.length < experiences.length && (
        <button onClick={() => setShowAll(true)}
          className="mt-5 w-full py-3 border border-gray-200 rounded-2xl text-sm font-bold text-gray-700 hover:border-amber-300 hover:text-amber-700 bg-white transition-colors">
          Show all {experiences.length} experiences
        </button>
      )}
    </div>
  )
}
