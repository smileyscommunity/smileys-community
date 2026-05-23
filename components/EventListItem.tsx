'use client'

import Image from 'next/image'
import type { Event } from '@/lib/data'
import { formatShortDate, formatTime, resolveImageUrl, BLUR_PLACEHOLDER } from '@/lib/data'

interface Props {
  event:    Event
  selected: boolean
  status?:  'joined' | 'pending' | null
  onSelect: (id: string) => void
}

export default function EventListItem({ event, selected, status, onSelect }: Props) {
  return (
    <button
      onClick={() => onSelect(event.id)}
      className={`w-full text-left flex items-center gap-3 px-4 py-3 border-b border-gray-100 transition-colors ${
        selected
          ? 'bg-amber-50 border-l-2 border-l-amber-500'
          : 'hover:bg-gray-50 border-l-2 border-l-transparent'
      }`}
    >
      {/* Thumbnail */}
      <div className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0">
        {event.coverImage ? (
          <Image
            src={resolveImageUrl(event.coverImage)}
            alt={event.title}
            fill
            className="object-cover"
            sizes="56px"
            placeholder="blur"
            blurDataURL={BLUR_PLACEHOLDER}
          />
        ) : (
          <div className={`w-full h-full flex items-center justify-center text-2xl ${
            event.isPremium ? 'bg-gradient-to-br from-amber-100 to-orange-100' : 'bg-gray-100'
          }`}>
            {event.emoji}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold leading-snug line-clamp-2 ${selected ? 'text-amber-700' : 'text-gray-900'}`}>
          {event.title}
        </p>
        <p className="text-xs text-gray-400 mt-0.5 truncate">
          {formatShortDate(event.date)} · {formatTime(event.time)} · {event.neighborhood}
        </p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
            event.price === 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
          }`}>
            {event.price === 0 ? 'Free' : `₺${event.price}`}
          </span>
          {status === 'joined' && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">✓ Joined</span>
          )}
          {status === 'pending' && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">⏳ Pending</span>
          )}
          {event.membersOnly && (
            <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">Members</span>
          )}
        </div>
      </div>

      {/* Arrow */}
      <svg className={`w-4 h-4 shrink-0 ${selected ? 'text-amber-500' : 'text-gray-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )
}
