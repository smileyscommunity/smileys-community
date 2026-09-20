'use client'

import { useEffect, useState } from 'react'
import QRCode from '@/components/QRCode'
import MembershipBadge from '@/components/MembershipBadge'
import { formatName, getInitials, resolveImageUrl } from '@/lib/data'
import { dayInTz, DEFAULT_TZ } from '@/lib/cityTime'
import { useCurrentCity } from '@/hooks/useCurrentCity'

interface Props {
  user: {
    id: string
    name: string
    color: string
    profilePhoto?: string | null
    membershipType?: string
    joinedAt?: string
    neighborhood?: string | null
  }
  /** The signed card token (lib/cardToken). Null while it's still coming. */
  qrValue?: string | null
  /** Why the code on screen isn't a fresh one, in the member's words. */
  qrNote?: string | null
}

// The code on the card, and the code full-screen. 140 rather than the old 84:
// a door scans this off a phone screen, often a dim one behind a plastic case,
// and the modules were a third of a millimetre each.
const CARD_QR  = 140
const LARGE_QR = 280

export default function DigitalCard({ user, qrValue = null, qrNote = null }: Props) {
  const [expanded, setExpanded] = useState(false)
  // The CITY's clock, not the phone's. A member scrolling their card in
  // another timezone joined on the day Istanbul (or Tbilisi) says they did.
  const tz = useCurrentCity()?.timezone ?? DEFAULT_TZ

  // Keeping the screen awake while the code is up: a phone that sleeps in the
  // queue is the second most common reason a card takes three tries. No API
  // can raise the brightness from a web page, so the overlay does the one
  // thing it can — fills the screen with white behind the code.
  useEffect(() => {
    if (!expanded) return
    let sentinel: WakeLockSentinel | null = null
    let dropped = false

    async function hold() {
      // Absent on iOS below 16.4 and every Firefox — the code still shows.
      if (!('wakeLock' in navigator)) return
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (dropped) { lock.release().catch(() => {}); return }
        sentinel = lock
      } catch {}
    }
    function release() {
      sentinel?.release().catch(() => {})
      sentinel = null
    }
    // The browser drops the lock itself when the tab goes away; taking it back
    // on return is on us, or the screen sleeps as soon as the member glances
    // at a message and comes back.
    function onVisibility() {
      if (document.visibilityState === 'visible') hold()
      else release()
    }

    hold()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      dropped = true
      document.removeEventListener('visibilitychange', onVisibility)
      release()
    }
  }, [expanded])

  const name     = formatName(user.name)
  const initials = getInitials(user.name)
  const photo    = resolveImageUrl(user.profilePhoto)
  // The CITY's year. Taking the year off the Date itself is the phone's
  // answer, which is a different year for anyone reading their card on New
  // Year's Eve in another zone. An unparseable stamp shows nothing at all
  // rather than the first four letters of "Invalid Date".
  const joined   = user.joinedAt ? new Date(user.joinedAt) : null
  const joinYear = joined && !Number.isNaN(joined.getTime()) ? dayInTz(joined, tz).slice(0, 4) : null
  const c = user.color

  const qr = qrValue
    ? <QRCode value={qrValue} size={CARD_QR} label={`Check-in code for ${name}`} />
    : (
      <div
        className="flex items-center justify-center text-center text-[11px] text-gray-400 px-2 leading-snug"
        style={{ width: CARD_QR, height: CARD_QR }}
      >
        No code on this device yet — open the app once with signal.
      </div>
    )

  return (
    <div className="w-full max-w-sm mx-auto select-none">
      <div
        className="relative rounded-3xl bg-white overflow-hidden"
        style={{ boxShadow: '0 1px 2px rgba(15,23,42,0.04), 0 12px 32px -8px rgba(15,23,42,0.08)' }}
      >
        {/* Thin color stripe — the only chromatic accent */}
        <div className="h-1.5" style={{ backgroundColor: c }} />

        {/* Header */}
        <div className="px-6 pt-5 pb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none">😊</span>
            <span className="text-[11px] font-bold tracking-[0.18em] text-gray-600 uppercase">Smileys</span>
          </div>
          {joinYear && (
            <span className="text-[10px] font-semibold tracking-[0.15em] text-gray-400 uppercase">
              Member · {joinYear}
            </span>
          )}
        </div>

        {/* Avatar / photo — centered, generous spacing */}
        <div className="px-6 pt-4 pb-3 flex flex-col items-center">
          <div
            className="w-24 h-24 rounded-full overflow-hidden flex items-center justify-center"
            style={{
              backgroundColor: c + '14',
              border: `2px solid ${c}22`,
            }}
          >
            {photo ? (
              <img src={photo} alt={name} className="w-full h-full object-cover" />
            ) : (
              <span
                className="font-extrabold"
                style={{ color: c, fontSize: '32px', letterSpacing: '-1px' }}
              >
                {initials}
              </span>
            )}
          </div>

          <h2 className="mt-4 text-[22px] font-extrabold text-gray-900 tracking-tight text-center leading-tight">
            {name}
          </h2>
          <MembershipBadge membershipType={user.membershipType} className="mt-2 text-[10px] px-2.5 py-1" />
          {user.neighborhood && (
            <p className="mt-1 text-[13px] text-gray-400">{user.neighborhood}</p>
          )}
        </div>

        {/* Soft divider */}
        <div className="mx-6 h-px bg-gray-100" />

        {/* The code, and what it's actually for */}
        <div className="px-6 py-4 flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => qrValue && setExpanded(true)}
            disabled={!qrValue}
            aria-label="Show the check-in code full screen"
            className="rounded-2xl bg-white p-2.5 disabled:cursor-default"
            style={{ border: `1px solid ${c}22` }}
          >
            {qr}
          </button>
          <p className="text-[11px] text-gray-400 text-center leading-snug">
            {qrValue ? 'Tap the code to enlarge it. The host scans it at events you’ve joined.' : 'The host checks you in at events you’ve joined.'}
          </p>
          {qrNote && <p className="text-[11px] text-amber-600 text-center leading-snug">{qrNote}</p>}
        </div>

        {/* Soft divider */}
        <div className="mx-6 h-px bg-gray-100" />

        {/* The id support asks for. Printed as it really is — it used to be
            upper-cased, which is not the id anyone can look up — and
            selectable, which the card's select-none took away. */}
        <div className="px-6 py-3">
          <p className="text-[10px] font-semibold tracking-[0.18em] text-gray-400 uppercase mb-1">
            Member ID (for support)
          </p>
          <p className="font-mono text-[11px] text-gray-600 break-all select-text">{user.id}</p>
        </div>
      </div>

      {expanded && qrValue && (
        // White, edge to edge: the brightest thing a web page is allowed to
        // do for a scanner in a dark bar.
        <div
          className="fixed inset-0 z-[80] bg-white flex flex-col items-center justify-center gap-6 p-6"
          onClick={() => setExpanded(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Check-in code"
        >
          <QRCode value={qrValue} size={LARGE_QR} label={`Check-in code for ${name}`} />
          <p className="text-sm font-semibold text-gray-900">{name}</p>
          {qrNote && <p className="text-xs text-amber-600 text-center max-w-xs">{qrNote}</p>}
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="px-6 py-2.5 rounded-xl bg-gray-100 text-gray-700 text-sm font-semibold"
          >
            Close
          </button>
        </div>
      )}
    </div>
  )
}
