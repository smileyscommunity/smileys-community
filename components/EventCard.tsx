'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import type { Event } from '@/lib/data'
import { formatShortDate, formatTime, formatPrice, vibeConfig, resolveImageUrl, BLUR_PLACEHOLDER, firstNameOf} from '@/lib/data'
import { getUrgency, getBarColor, buildSocialLabel } from '@/lib/utils/event'
import { neighborhoodToSlug } from '@/lib/neighborhoods'
import AvatarStack from '@/components/AvatarStack'
import EventBadges from '@/components/EventBadges'

import { useRSVP } from '@/hooks/useRSVP'
import NoShowAckModal from '@/components/NoShowAckModal'
import { isSoldOut, isManuallySoldOut } from '@/lib/soldOut'

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  // tabIndex on the wrapper + :focus-within (rather than only :hover) is what
  // makes this reachable for keyboard users — some callers pass a plain,
  // non-interactive span as children with nothing else focusable inside.
  // role="tooltip" + aria-describedby exposes the text to screen readers too;
  // previously it was hover-only and invisible to both.
  const id = useId()
  return (
    <span className="group/tip relative inline-flex" tabIndex={0} aria-describedby={id}>
      {children}
      <span id={id} role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
        invisible opacity-0 group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100 transition-opacity duration-150">
        <span className="block bg-gray-900 text-white text-xs font-medium leading-tight px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
          {text}
        </span>
        <span className="block w-2 h-2 bg-gray-900 rotate-45 mx-auto -mt-1" />
      </span>
    </span>
  )
}

interface EventCardProps {
  event:        Event
  linkPrefix?:  string
  initialStatus?: 'joined' | 'pending' | 'waitlisted' | null
  // The city named on the date pill. Omitted → no city shown: callers that
  // don't know the view city must not stamp the founding city's name on
  // every card (a Bodrum event card used to read "· Istanbul").
  cityName?:    string
}

export default function EventCard({ event, linkPrefix = '/events', initialStatus, cityName }: EventCardProps) {
  const href        = `${linkPrefix}/${event.id}`
  const router      = useRouter()
  const goingCount  = event.totalSpots - event.spotsLeft

  function goToNeighborhood(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    router.push(`/neighborhoods/${neighborhoodToSlug(event.neighborhood)}`)
  }

  // Vibe pills used to be inert (just a tooltip) even though the exact
  // same tags are already filterable via the /events Filters sheet — this
  // wires the card pill straight into that existing filter instead of
  // building a second filtering mechanism.
  function goToVibeFilter(e: React.MouseEvent, vibe: string) {
    e.preventDefault()
    e.stopPropagation()
    router.push(`/events?tags=${encodeURIComponent(vibe)}`)
  }
  const fillPercent = event.totalSpots > 0 ? (goingCount / event.totalSpots) * 100 : 0
  const urgency     = getUrgency(event.spotsLeft, event.totalSpots, event.limitedSpots, fillPercent, event.soldOut)
  const barColor    = getBarColor(fillPercent)

  const { status, loading, join, ackRequest, confirmAck, cancelAck } = useRSVP(event.id, initialStatus)
  const isCancelled = event.status === 'cancelled'
  // Counter-full or said-so-by-a-human — the card treats both the same, and
  // lib/soldOut is the one place that decides which.
  const soldOut     = isSoldOut(event)
  const saidSoldOut = isManuallySoldOut(event)

  async function handleJoin(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (isCancelled) return
    if (status !== 'idle' && status !== 'error') return
    await join()
  }

  return (
    <>
    <NoShowAckModal open={!!ackRequest} onConfirm={confirmAck} onCancel={cancelAck} busy={loading} />
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
    >
    <Link href={href} className="group block">
      <div className="card group-hover:-translate-y-1 transition-transform duration-300">

        {/* Image area */}
        <div className="relative h-52 overflow-hidden">
          {event.coverImage ? (
            <>
              <Image
                src={resolveImageUrl(event.coverImage)}
                alt={event.title}
                fill
                className="object-cover group-hover:scale-[1.03] transition-transform duration-500"
                sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                placeholder="blur"
                blurDataURL={BLUR_PLACEHOLDER}
                style={{ objectPosition: `center ${event.coverImagePosition ?? 50}%` }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent pointer-events-none" />
            </>
          ) : (
            <div aria-hidden="true" className={`w-full h-full flex items-center justify-center ${
              event.isPremium
                ? 'bg-gradient-to-br from-amber-200 via-yellow-100 to-orange-100'
                : 'bg-gradient-to-br from-amber-100 to-orange-100'
            }`}>
              <span className="text-6xl select-none">{event.emoji}</span>
            </div>
          )}

          {event.membersOnly && (
            <div className="absolute inset-0 bg-gradient-to-t from-violet-900/40 to-transparent pointer-events-none" />
          )}

          {/* Cancelled overlay — wins over membersOnly tint so the banner is unambiguous.
              Pointer-events-none lets the underlying Link still navigate. */}
          {isCancelled && (
            <>
              <div className="absolute inset-0 bg-red-950/45 backdrop-grayscale pointer-events-none" />
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
                <span className="bg-red-600 text-white text-sm font-extrabold tracking-widest uppercase px-4 py-1.5 rounded-md shadow-lg -rotate-6">
                  Cancelled
                </span>
              </div>
            </>
          )}

          {/* Same stamp language as Cancelled, deliberately softer: sold out
              is disappointing, not void, and the waitlist below is still a
              real thing to do. No grayscale for that reason. */}
          {soldOut && !isCancelled && (
            <>
              <div className="absolute inset-0 bg-gray-950/35 pointer-events-none" />
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none">
                <span className="bg-violet-600 text-white text-sm font-extrabold tracking-widest uppercase px-4 py-1.5 rounded-md shadow-lg -rotate-6">
                  Sold out
                </span>
              </div>
            </>
          )}

          <EventBadges event={event} urgency={urgency} className="absolute top-3 left-3" />

          <button
            type="button"
            onClick={goToNeighborhood}
            aria-label={`See events in ${event.neighborhood}`}
            className="absolute top-3 right-3 badge bg-white/90 text-gray-700 shadow-sm cursor-pointer hover:bg-amber-50 hover:text-amber-600 transition-colors before:absolute before:content-[''] before:-inset-x-2 before:-inset-y-3"
          >
            {event.neighborhood}
          </button>

          {/* Date + Featured overlay at bottom of image */}
          <div className="absolute bottom-0 left-0 right-0 px-3 pb-2.5 flex items-end justify-between">
            <div className="flex items-center gap-1.5 bg-black/60 backdrop-blur-sm text-white text-[11px] font-bold px-2.5 py-1 rounded-full">
              <svg className="w-3 h-3 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {formatShortDate(event.date)} · {formatTime(event.time)}{cityName ? ` · ${cityName}` : ''}
            </div>
            {event.featured && (
              <div className="flex items-center gap-1 bg-amber-500 text-white text-[11px] font-bold px-2.5 py-1 rounded-full shadow-md">
                ★ Featured
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <h3 className="font-bold text-gray-900 text-base leading-snug group-hover:text-amber-600 transition-colors line-clamp-2">
              {event.title}
            </h3>
            {event.intent === 'professional' && (
              <span className="shrink-0 text-[9px] font-black uppercase tracking-widest bg-zinc-900 text-white px-1.5 py-0.5 rounded shadow-sm border border-zinc-800">
                Networking
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mb-3 text-xs text-gray-600">
            <button
              type="button"
              onClick={goToNeighborhood}
              aria-label={`See events in ${event.neighborhood}`}
              className="relative flex items-center gap-1 cursor-pointer hover:text-amber-600 transition-colors truncate before:absolute before:content-[''] before:-inset-x-1 before:-inset-y-3.5"
            >
              <svg className="w-3 h-3 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="truncate">{event.neighborhood}</span>
            </button>
            {event.hostName && (
              <span className="flex items-center gap-1 shrink-0">
                <div
                  className="w-4 h-4 rounded-full overflow-hidden flex items-center justify-center text-white text-[8px] font-bold shrink-0"
                  style={{ backgroundColor: event.hostColor ?? '#f59e0b' }}
                >
                  {event.hostPhoto
                    ? <img src={resolveImageUrl(event.hostPhoto)} alt={event.hostName} className="w-full h-full object-cover" />
                    : event.hostName.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
                  }
                </div>
                <span className="truncate">{firstNameOf(event.hostName)}</span>
              </span>
            )}
          </div>

          {event.vibes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {event.vibes.slice(0, 3).map((vibe) => {
                const cfg = vibeConfig[vibe]
                return cfg ? (
                  <Tip key={vibe} text={`${cfg.description} — tap to see more ${vibe} events`}>
                    <button
                      type="button"
                      onClick={(e) => goToVibeFilter(e, vibe)}
                      className={`badge shrink-0 ${cfg.bg} ${cfg.text} gap-1 hover:brightness-95 transition-[filter]`}
                    >
                      <span aria-hidden="true">{cfg.emoji}</span> {vibe}
                    </button>
                  </Tip>
                ) : null
              })}
            </div>
          )}

          {/* Social proof + spots */}
          <div className="flex items-center gap-2 mb-3 min-h-[20px]">
            {goingCount > 0 ? (
              <>
                {event.attendeePreviews && event.attendeePreviews.length > 0 && (
                  <AvatarStack people={event.attendeePreviews} total={goingCount} max={3} size="sm" />
                )}
                <span className="text-xs text-gray-600 flex-1 truncate">
                  {buildSocialLabel(event.attendeePreviews, goingCount)}
                </span>
              </>
            ) : (
              <span className="text-xs text-gray-400">Be the first to join</span>
            )}
            {event.limitedSpots && event.spotsLeft <= 5 && event.spotsLeft > 0 && !urgency && !soldOut && (
              <span className="text-[11px] font-semibold text-orange-500 bg-orange-50 px-2 py-0.5 rounded-full shrink-0">
                {event.spotsLeft} left
              </span>
            )}
          </div>

          {/* Spots bar */}
          {event.limitedSpots && (
            <div className="mb-3">
              <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${fillPercent}%`, backgroundColor: barColor }} />
              </div>
            </div>
          )}

          {/* Price + Join */}
          <div className="flex items-center justify-between pt-3 border-t border-gray-100">
            {event.price === 0 ? (
              <span className="text-sm font-bold text-green-600">Free</span>
            ) : event.memberPrice ? (
              <div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xs text-violet-600 font-semibold">Members</span>
                  <span className="text-sm font-bold text-violet-700">{formatPrice(event.memberPrice!, event.currency)}</span>
                </div>
                {!event.membersOnly && (
                  <div className="text-xs text-gray-400">Guests {formatPrice(event.price, event.currency)}</div>
                )}
              </div>
            ) : (
              <span className="text-sm font-bold text-gray-900">{formatPrice(event.price, event.currency)}</span>
            )}

            <motion.button
              onClick={handleJoin}
              disabled={isCancelled || status !== 'idle'}
              whileTap={!isCancelled && status === 'idle' ? { scale: 0.93 } : {}}
              className={`text-xs font-semibold py-1.5 min-h-[44px] rounded-lg transition-colors disabled:cursor-default overflow-hidden ${
                soldOut && status === 'idle' && !isCancelled ? 'px-2' : 'px-3'
              } ${
                isCancelled         ? 'bg-red-100 text-red-700'      :
                status === 'joined'  ? 'bg-green-100 text-green-700' :
                status === 'pending' ? 'bg-amber-100 text-amber-700' :
                status === 'loading' ? 'bg-gray-100 text-gray-400'   :
                status === 'error'   ? 'bg-red-100 text-red-600'     :
                soldOut
                  ? 'bg-violet-100 text-violet-700'
                  : 'bg-amber-500 hover:bg-amber-600 text-white'
              }`}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={status}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.14 }}
                  className="block"
                >
                  {isCancelled         ? 'Cancelled'  :
                   status === 'joined'  ? '✓ Joined'   :
                   status === 'pending' ? '⏳ Pending'  :
                   status === 'loading' ? '…'          :
                   status === 'error'   ? 'Error'      :
                   soldOut ? `${saidSoldOut ? 'Sold out' : 'Full'} · Join waitlist${event.waitlistCount ? ` (${event.waitlistCount})` : ''}` :
                   event.approvalRequired                      ? 'Request' :
                   'Join'}
                </motion.span>
              </AnimatePresence>
            </motion.button>
          </div>
        </div>
      </div>
    </Link>
    </motion.div>
    </>
  )
}
