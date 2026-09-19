'use client'

import Link from 'next/link'
import posthog from 'posthog-js'

/** Only what the tile shows — the page used to hand this client component
 *  whole club rows, invite links and spotlight fields included. */
export interface LineupClub {
  id: string; slug: string; name: string; emoji: string; bgColor: string; category: string; memberCount: number
}

// "Your lineup" — club picks for a member's first weeks, matched to the
// interests they chose at registration (lib/clubRecommendations). The
// public onboarding teaser had a version of this screen that died at the
// account boundary; this is the one members actually see, fed by the
// answers they actually gave. Client component so clicks are measurable —
// whether the lineup converts to club joins is the success metric of the
// whole five-questions build.
export default function RecommendedClubs({ clubs }: { clubs: LineupClub[] }) {
  if (clubs.length === 0) return null
  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-bold text-gray-900">🎯 Clubs picked for you</h2>
        <Link href="/clubs" className="text-xs font-semibold text-amber-600 hover:text-amber-700">All clubs →</Link>
      </div>
      <p className="text-xs text-gray-500 mb-4">Matched to the interests you chose when you joined.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {clubs.map((c, idx) => (
          <Link key={c.id} href={`/clubs/${c.slug}`}
            onClick={() => posthog.capture('lineup_club_clicked', { club_id: c.id, club_category: c.category, position: idx })}
            className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-amber-200 hover:bg-amber-50/40 transition-colors">
            {/* bgColor is a Tailwind class ('bg-amber-50'), not a colour value. */}
            <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 ${c.bgColor || 'bg-amber-50'}`} aria-hidden="true">{c.emoji}</span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-gray-900 truncate">{c.name}</span>
              <span className="block text-xs text-gray-500">{c.category} · {c.memberCount} member{c.memberCount === 1 ? '' : 's'}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
