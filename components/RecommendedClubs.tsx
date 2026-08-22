import Link from 'next/link'
import type { Club } from '@/lib/data'

// "Your lineup" — club picks for a member's first weeks, matched to the
// interests they chose at registration (lib/clubRecommendations). The
// public onboarding teaser had a version of this screen that died at the
// account boundary; this is the one members actually see, fed by the
// answers they actually gave.
export default function RecommendedClubs({ clubs }: { clubs: Club[] }) {
  if (clubs.length === 0) return null
  return (
    <div className="bg-white rounded-2xl shadow-card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-bold text-gray-900">🎯 Clubs picked for you</h2>
        <Link href="/clubs" className="text-xs font-semibold text-amber-600 hover:text-amber-700">All clubs →</Link>
      </div>
      <p className="text-xs text-gray-500 mb-4">Matched to the interests you chose when you joined.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {clubs.map(c => (
          <Link key={c.id} href={`/clubs/${c.slug}`}
            className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-amber-200 hover:bg-amber-50/40 transition-colors">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ backgroundColor: c.bgColor }} aria-hidden="true">{c.emoji}</span>
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
