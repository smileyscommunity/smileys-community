'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import Image from 'next/image'
import type { Event } from '@/lib/data'
import { formatDate, formatTime, vibeConfig, resolveImageUrl, BLUR_PLACEHOLDER } from '@/lib/data'
import { getBarColor, getUrgency } from '@/lib/utils/event'
import RSVPButton from '@/components/RSVPButton'
import AvatarStack from '@/components/AvatarStack'
import { sanitize } from '@/lib/sanitize'
import ShareButton from '@/components/ShareButton'
import EventBadges from '@/components/EventBadges'
import { APP_URL } from '@/lib/env'

const MiniMap = dynamic(() => import('@/components/MiniMap'), { ssr: false })

interface Props {
  event:         Event
  initialStatus: 'joined' | 'pending' | null
}

export default function EventPreviewPane({ event, initialStatus }: Props) {
  const goingCount  = event.totalSpots - event.spotsLeft
  const fillPercent = event.totalSpots > 0 ? (goingCount / event.totalSpots) * 100 : 0
  const urgency     = getUrgency(event.spotsLeft, event.totalSpots, event.limitedSpots, fillPercent)
  const barColor    = getBarColor(fillPercent)
  const today       = new Date().toISOString().split('T')[0]
  const isPast      = event.date < today

  const hasCoords  = event.lat != null && event.lng != null
  const mapsHref   = event.meetingUrl
    ?? (event.address
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address + ', Istanbul')}`
      : hasCoords
      ? `https://www.google.com/maps?q=${event.lat},${event.lng}`
      : undefined)

  return (
    <div className="h-full flex flex-col">
      {/* Cover */}
      <Link href={`/events/${event.id}`} className="relative h-52 shrink-0 overflow-hidden bg-gray-100 block group">
        {event.coverImage ? (
          <Image
            src={resolveImageUrl(event.coverImage)}
            alt={event.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(min-width: 1280px) 60vw, 100vw"
            placeholder="blur"
            blurDataURL={BLUR_PLACEHOLDER}
          />
        ) : (
          <div className={`w-full h-full flex items-center justify-center ${
            event.isPremium
              ? 'bg-gradient-to-br from-amber-200 via-yellow-100 to-orange-100'
              : 'bg-gradient-to-br from-amber-100 to-orange-100'
          }`}>
            <span className="text-8xl select-none">{event.emoji}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-200 flex items-center justify-center">
          <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 text-white text-xs font-semibold px-3 py-1.5 rounded-full">
            View full details →
          </span>
        </div>
        {/* Gradient overlay for readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />

        {/* Badges */}
        <EventBadges event={event} urgency={urgency} className="absolute top-3 left-3 shadow-md" />

        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <ShareButton
            title={event.title}
            url={`${APP_URL}/events/${event.id}`}
            variant="overlay"
          />
          <Link
            href={`/events/${event.id}`}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 backdrop-blur-sm rounded-xl text-xs font-semibold text-gray-700 hover:bg-white transition-colors shadow"
          >
            Open full page
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </Link>
        </div>
      </Link>

      {/* Content — scrollable */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Title */}
        <div>
          <h2 className="text-xl font-extrabold text-gray-900 leading-snug">{event.title}</h2>
          {event.hostName && (
            <p className="text-sm text-gray-600 mt-1">Hosted by <span className="font-medium text-gray-700">{event.hostName}</span></p>
          )}
        </div>

        {/* Meta row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-50 rounded-xl px-4 py-3">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-0.5">When</p>
            <p className="text-sm font-semibold text-gray-900">{formatDate(event.date)}</p>
            <p className="text-xs text-gray-600">{formatTime(event.time)}</p>
          </div>
          <div className="bg-gray-50 rounded-xl px-4 py-3">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-0.5">Where</p>
            <p className="text-sm font-semibold text-gray-900 truncate">{event.location || event.neighborhood}</p>
            <p className="text-xs text-gray-600 truncate">{event.neighborhood}</p>
            {event.meetingUrl && (
              <a
                href={event.meetingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-xs text-amber-600 hover:text-amber-700 font-semibold transition-colors"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                View on map
              </a>
            )}
          </div>
        </div>

        {/* Mini map */}
        {hasCoords && (
          <MiniMap
            lat={event.lat!}
            lng={event.lng!}
            href={mapsHref}
          />
        )}

        {/* RSVP */}
        {!isPast && (
          <RSVPButton
            eventId={event.id}
            hostId={event.hostId}
            spotsLeft={event.spotsLeft}
            price={event.price}
            memberPrice={event.memberPrice}
            membersOnly={event.membersOnly}
            currency={event.currency}
          />
        )}

        {/* Capacity */}
        <div>
          <div className="flex items-center justify-between mb-1.5 text-xs font-semibold">
            <span className="text-gray-700">{goingCount} / {event.totalSpots} going</span>
            <span style={{ color: barColor }}>{Math.round(fillPercent)}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${fillPercent}%`, backgroundColor: barColor }} />
          </div>
          {event.attendeePreviews && event.attendeePreviews.length > 0 && (
            <div className="flex items-center gap-2 mt-2">
              <AvatarStack people={event.attendeePreviews} total={goingCount} max={6} size="sm" />
            </div>
          )}
        </div>

        {/* Vibes */}
        {event.vibes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {event.vibes.map(vibe => {
              const cfg = vibeConfig[vibe as keyof typeof vibeConfig]
              return cfg ? (
                <span key={vibe} className={`text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.bg} ${cfg.text}`}>
                  {cfg.emoji} {vibe}
                </span>
              ) : null
            })}
          </div>
        )}

        {/* Description */}
        <div>
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">About</p>
          <div className="rich-content text-sm text-gray-600 leading-relaxed" dangerouslySetInnerHTML={{ __html: sanitize(event.description ?? '') }} />
        </div>

        {/* Details */}
        <div className="space-y-2 text-xs text-gray-600">
          {event.price > 0 && (
            <div className="flex justify-between">
              <span>Price</span>
              <span className="font-semibold text-gray-800">
                {event.memberPrice ? `₺${event.memberPrice} (member) · ₺${event.price} (guest)` : `₺${event.price}`}
              </span>
            </div>
          )}
          {event.language && <div className="flex justify-between"><span>Language</span><span className="font-semibold text-gray-800">{event.language}</span></div>}
          {event.minAge && <div className="flex justify-between"><span>Min age</span><span className="font-semibold text-gray-800">{event.minAge}+</span></div>}
          {event.refundPolicy && <div className="flex justify-between"><span>Refund</span><span className="font-semibold text-gray-800">{event.refundPolicy}</span></div>}
        </div>
      </div>
    </div>
  )
}
