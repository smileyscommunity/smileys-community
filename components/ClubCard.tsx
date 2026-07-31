import Link from 'next/link'
import { Club, formatShortDate } from '@/lib/data'

interface ClubCardProps {
  club: Club
  // Marketing surfaces (homepage) pass true so a backfilled club without
  // a scheduled event just omits the line instead of advertising a
  // "No upcoming events" dead-end to prospects.
  hideEmptyNextEvent?: boolean
}

export default function ClubCard({ club, hideEmptyNextEvent = false }: ClubCardProps) {
  return (
    <Link href={`/clubs/${club.slug}`} className="group block">
      <div className="card group-hover:-translate-y-1 transition-transform duration-300 h-full">
        {/* Header */}
        <div aria-hidden="true" className={`${club.bgColor} h-28 flex items-center justify-center`}>
          <span className="text-5xl select-none">{club.emoji}</span>
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col h-[calc(100%-7rem)]">
          <div className="mb-1">
            <span className={`text-xs font-semibold ${club.color} uppercase tracking-wide`}>
              {club.category}
            </span>
          </div>

          <h3 className="font-bold text-gray-900 text-base mb-2 group-hover:text-amber-600 transition-colors">
            {club.name}
          </h3>

          <p className="text-sm text-gray-600 leading-relaxed line-clamp-2 flex-1">
            {club.description}
          </p>

          {/* Next event */}
          {club.nextEvent ? (
            <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-600 font-medium">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="truncate">{formatShortDate(club.nextEvent.date)} · {club.nextEvent.title}</span>
            </div>
          ) : hideEmptyNextEvent ? null : (
            <div className="mt-3 text-xs text-gray-400">No upcoming events</div>
          )}

          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-gray-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>{club.memberCount} {club.memberCount === 1 ? 'member' : 'members'}</span>
            </div>

            <span className="text-xs text-amber-600 font-semibold group-hover:underline">
              View club →
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}
