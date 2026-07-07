'use client'

import type { Event } from '@/lib/data'

interface Props {
  event: Pick<Event, 'membersOnly' | 'isPremium' | 'genderBalance' | 'isFirstTimerFriendly'>
  urgency?: { label: string; bg: string; text: string; pulse: boolean } | null
  className?: string
}

function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
        invisible opacity-0 group-hover/tip:visible group-hover/tip:opacity-100 transition-opacity duration-150">
        <span className="block bg-gray-900 text-white text-xs font-medium leading-tight px-2.5 py-1.5 rounded-lg whitespace-nowrap shadow-lg">
          {text}
        </span>
        <span className="block w-2 h-2 bg-gray-900 rotate-45 mx-auto -mt-1" />
      </span>
    </span>
  )
}

export default function EventBadges({ event, urgency, className = '' }: Props) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {event.membersOnly && (
        <Tip text="Exclusive to approved Smileys members">
          <span className="badge bg-violet-600 text-white gap-1 shadow-sm">🔒 Members only</span>
        </Tip>
      )}
      {event.isPremium && !event.membersOnly && (
        <Tip text="Curated premium experience for vetted members">
          <span className="badge bg-gray-900 text-amber-400 gap-1 shadow-sm">♛ Premium</span>
        </Tip>
      )}
      {event.genderBalance && (
        <Tip text="Spots split equally between men & women for a balanced mix">
          <span className="badge bg-pink-500 text-white gap-1 shadow-sm">⚖️ Gender balanced</span>
        </Tip>
      )}
      {event.isFirstTimerFriendly && (
        <Tip text="A welcoming, low-commitment event — perfect if it's your first time">
          <span className="badge bg-emerald-500 text-white gap-1 shadow-sm">👋 First-timer friendly</span>
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
