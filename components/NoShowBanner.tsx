'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'

// Member-facing no-show standing, in the same slot as the verify-email and
// pending-approval strips. Yellow: a heads-up that the next RSVP asks for a
// confirmation. Red: RSVPs paused (or about to be), with the dates and the
// appeal route. Factual, no scolding; hidden on the /no-show page itself,
// which says the same thing at length.

interface Card {
  id: string; kind: 'yellow' | 'red'; status: string
  event: { title: string; emoji: string }
  acknowledgedAt: string | null
  appealDeadlineAt: string | null; appealStatus: string | null
  restrictionStartsAt: string | null; restrictionEndsAt: string | null
  canAppeal: boolean
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export default function NoShowBanner() {
  const { isLoggedIn } = useAuth()
  const pathname = usePathname()
  const [cards, setCards] = useState<Card[] | null>(null)

  // Once per sign-in, not per navigation: a card changes a few times a
  // season, and this strip sits on every page for every member.
  useEffect(() => {
    if (!isLoggedIn) { setCards(null); return }
    fetch('/app/api/no-show/status', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => setCards(d?.cards ?? []))
      .catch(() => setCards([]))
  }, [isLoggedIn])

  if (!isLoggedIn || !cards?.length || pathname === '/no-show') return null

  const red    = cards.find(c => c.kind === 'red')
  const yellow = cards.find(c => c.kind === 'yellow' && !c.acknowledgedAt)
  const now    = Date.now()

  if (red) {
    const starts = red.restrictionStartsAt ? new Date(red.restrictionStartsAt).getTime() : null
    const ends   = red.restrictionEndsAt   ? fmt(red.restrictionEndsAt) : null
    const text =
      red.status === 'appeal_pending' ? `Your appeal for "${red.event.title}" is being reviewed — nothing is paused meanwhile.` :
      starts && starts > now           ? `Second no-show at "${red.event.title}". RSVPs pause on ${fmt(red.restrictionStartsAt!)}${red.canAppeal ? ` — you can appeal until ${fmt(red.appealDeadlineAt!)}` : ''}.` :
                                         `RSVPs and waitlists are paused until ${ends} after a second no-show at "${red.event.title}".`
    return (
      <div className="bg-red-50 border-b border-red-200" role="region" aria-label="RSVP status">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-lg leading-none" aria-hidden="true">🟥</span>
          <p className="text-sm text-red-800 flex-1">{text}</p>
          <Link href="/no-show" className="text-xs font-semibold text-red-700 hover:text-red-900 underline whitespace-nowrap">
            {red.canAppeal ? 'Details & appeal' : 'Details'}
          </Link>
        </div>
      </div>
    )
  }

  if (yellow) {
    return (
      <div className="bg-amber-50 border-b border-amber-200" role="region" aria-label="RSVP status">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-lg leading-none" aria-hidden="true">🟨</span>
          <p className="text-sm text-amber-800 flex-1">
            We missed you at <strong>{yellow.event.title}</strong>. Next time you RSVP we&apos;ll ask you to confirm you&apos;re coming — that&apos;s all.
          </p>
          <Link href="/no-show" className="text-xs font-semibold text-amber-700 hover:text-amber-900 underline whitespace-nowrap">
            What this means
          </Link>
        </div>
      </div>
    )
  }
  return null
}
