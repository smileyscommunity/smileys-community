'use client'

import { useId } from 'react'
import type { Event } from '@/lib/data'

interface Props {
  event: Pick<Event, 'membersOnly' | 'isPremium' | 'genderBalance' | 'isFirstTimerFriendly'>
  urgency?: { label: string; bg: string; text: string; pulse: boolean } | null
  className?: string
  // 'solid' — filled pills for cards / over cover photos (default).
  // 'outline' — light tinted pills for the detail-page header. One source
  // of truth for badge copy + tooltips; the detail page used to duplicate
  // all four badges inline with a diverging style.
  variant?: 'solid' | 'outline'
  layout?: 'col' | 'row'
}

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  // tabIndex on the wrapper + :focus-within (rather than only :hover) is what
  // makes this reachable for keyboard users — callers here pass a plain,
  // non-interactive span as children, so nothing else is focusable inside.
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

export default function EventBadges({ event, urgency, className = '', variant = 'solid', layout = 'col' }: Props) {
  const pill = (solid: string, outline: string) =>
    variant === 'outline'
      ? `inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full cursor-default ${outline}`
      : `badge gap-1 shadow-sm ${solid}`
  return (
    <div className={`flex ${layout === 'row' ? 'flex-row flex-wrap items-center gap-2' : 'flex-col gap-1.5'} ${className}`}>
      {event.membersOnly && (
        <Tip text="Exclusive to approved Smileys members">
          <span className={pill('bg-violet-600 text-white', 'text-violet-700 bg-violet-50 border border-violet-200')}>🔒 Members only</span>
        </Tip>
      )}
      {event.isPremium && !event.membersOnly && (
        <Tip text="Curated premium experience for vetted members">
          <span className={pill('bg-gray-900 text-amber-400', 'text-amber-700 bg-amber-50 border border-amber-200')}>♛ Premium</span>
        </Tip>
      )}
      {event.genderBalance && (
        <Tip text="Spots split equally between men & women for a balanced mix">
          <span className={pill('bg-pink-500 text-white', 'text-pink-700 bg-pink-50 border border-pink-200')}>⚖️ Gender balanced</span>
        </Tip>
      )}
      {event.isFirstTimerFriendly && (
        <Tip text="A welcoming, low-commitment event — perfect if it's your first time">
          <span className={pill('bg-emerald-500 text-white', 'text-emerald-700 bg-emerald-50 border border-emerald-200')}>👋 First-timer friendly</span>
        </Tip>
      )}
      {urgency && (
        <span className={`badge ${urgency.bg} ${urgency.text} flex items-center gap-1.5`}>
          {urgency.pulse && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
            </span>
          )}
          {urgency.label}
        </span>
      )}
    </div>
  )
}
