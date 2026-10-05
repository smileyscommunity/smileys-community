import Link from 'next/link'

// The two places this page hands off to, named for what they answer. The
// Guide is the editorial half ("what should I experience here"); the
// calendar is everything, not just what a host tagged as an experience.
// Neither was linked from the shelves — the Guide pointed here and nothing
// pointed back.

export default function Crosslinks({ cityName, guideHref, eventsHref }: { cityName: string; guideHref: string; eventsHref: string }) {
  const card = 'bg-white hover:bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3.5 transition-colors group'
  return (
    <div className="grid sm:grid-cols-2 gap-3 pt-2">
      <Link href={guideHref} className={card}>
        <div className="flex items-center gap-3">
          <div className="text-xl shrink-0" aria-hidden="true">🗺️</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 leading-tight">Ideas, not dates?</p>
            <p className="text-xs text-gray-600 mt-0.5">The {cityName} Guide — places and experiences recommended by people who live here.</p>
          </div>
          <span className="text-sm font-bold text-gray-700 shrink-0 group-hover:translate-x-0.5 transition-transform" aria-hidden="true">→</span>
        </div>
      </Link>
      <Link href={eventsHref} className={card}>
        <div className="flex items-center gap-3">
          <div className="text-xl shrink-0" aria-hidden="true">📅</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-900 leading-tight">Everything on the calendar</p>
            <p className="text-xs text-gray-600 mt-0.5">All events in {cityName} — dinners, coworking, language meetups and the rest.</p>
          </div>
          <span className="text-sm font-bold text-gray-700 shrink-0 group-hover:translate-x-0.5 transition-transform" aria-hidden="true">→</span>
        </div>
      </Link>
    </div>
  )
}
