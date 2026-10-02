'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import DigitalCard from '@/components/DigitalCard'
import {
  cacheCardProfile, cardTokenExpired, loadCardToken, readCachedCardProfile,
  type CardProfileCache, type CardTokenState,
} from '@/lib/memberCard'

interface CardProfile {
  id: string
  name: string
  color: string
  profilePhoto?: string | null
  membershipType?: string
  joinedAt?: string
  neighborhood?: string | null
}

// The partner pass: what a business checks before giving a member perk.
// A screenshot of a profile proves nothing, so this shows the member's name
// with a clock that ticks every second — a live screen is easy to tell from
// a picture of one. It needs no network, like the rest of this page.
function LivePass({ name }: { name: string }) {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const day  = now?.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  // hourCycle 'h23', never hour12:false (renders midnight as 24:MM).
  const time = now?.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
  return (
    <section aria-labelledby="pass-title" className="w-full max-w-xs bg-white rounded-2xl shadow-card p-4 text-center">
      <h2 id="pass-title" className="text-xs font-bold text-gray-600 uppercase tracking-widest mb-2">Partner perks pass</h2>
      <p className="text-lg font-extrabold text-gray-900">{name}</p>
      <p className="text-sm text-gray-600">Smileys member · valid today</p>
      <p className="mt-2 text-sm font-semibold text-gray-900">{day ?? ' '}</p>
      <p className="flex items-center justify-center gap-2 font-mono text-2xl font-bold text-amber-800 tabular-nums" aria-live="off">
        <span aria-hidden="true" className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        {time ?? '--:--:--'}
      </p>
      <p className="text-xs text-gray-500 mt-2 leading-relaxed">
        Show this at a partner. The clock is live — a screenshot won&apos;t tick.
      </p>
    </section>
  )
}

// The card opens at a door, and a door is where the signal is worst. So
// nothing here waits on the network: the page draws from the session the app
// already holds, the code is whatever this device last minted, and both
// fetches are refreshes that are allowed to fail quietly.
export default function MemberCardPage() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<CardProfile | null>(null)
  // What this phone last saw of /me. The session the layout holds carries no
  // membershipType, joinedAt or profilePhoto, so without this an offline card
  // is initials and no badge.
  const [cached,  setCached]  = useState<CardProfileCache | null>(null)
  const [stale,   setStale]   = useState(false)
  const [card,    setCard]    = useState<CardTokenState | null>(null)
  // Bumped on focus / visibilitychange: a PWA left open overnight held the
  // code it minted yesterday, and the page never asked again.
  const [freshen, setFreshen] = useState(0)

  useEffect(() => {
    if (!user.id || user.id === 'guest') return
    let live = true
    // Straight away, before the fetch: at a door the fetch may never answer,
    // and the card shouldn't spend that time pretending it knows nothing.
    setCached(readCachedCardProfile(user.id))
    fetch('/app/api/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('no')))
      .then(d => {
        if (!live || !d?.id) return
        setProfile(d)
        setStale(false)
        cacheCardProfile(user.id, d)
      })
      // A refresh that didn't land changes nothing on screen except the one
      // line that says so. It used to seed a made-up profile whose tier was
      // the string 'member' — not a tier we have (lib/membership) — so a
      // paying member's card quietly lost its badge, its neighborhood and
      // its join year the moment /me hiccuped.
      .catch(() => { if (live) setStale(true) })
    return () => { live = false }
  }, [user.id, freshen])

  useEffect(() => {
    if (!user.id || user.id === 'guest') return
    let live = true
    loadCardToken(user.id).then(s => { if (live) setCard(s) })
    return () => { live = false }
  }, [user.id, freshen])

  // The card is a screen people leave open — in a pocket on the way to the
  // venue, overnight in an installed PWA. Coming back to it re-mints: the
  // alternative is a dead code shown with no warning, because nothing
  // re-ran to notice the day had turned.
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') setFreshen(n => n + 1) }
    window.addEventListener('focus', again)
    document.addEventListener('visibilitychange', again)
    return () => {
      window.removeEventListener('focus', again)
      document.removeEventListener('visibilitychange', again)
    }
  }, [])

  // The session first, then what this phone last saw, then the live refresh
  // on top. Never the other way round: /me is the one that can be missing.
  const data: CardProfile = {
    id:             user.id,
    name:           user.name,
    color:          user.color,
    profilePhoto:   user.profilePhoto,
    membershipType: user.membershipType,
    joinedAt:       user.joinedAt,
    neighborhood:   user.neighborhood,
    ...(cached ?? {}),
    ...(profile ?? {}),
  }

  // Asked at render, not once when the code loaded: `card.expired` was the
  // answer at load time, and the page that matters here is one that has been
  // open since yesterday.
  const expired = !!card?.token && cardTokenExpired(card.token)

  const qrNote = expired
    ? 'Reopen when you have signal to refresh this code.'
    : card?.cached
      ? 'Showing the code saved on this phone.'
      : null

  return (
    <div className="bg-warm flex flex-col">
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-sm mx-auto px-4 pt-6 pb-3">
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Member Card</h1>
          <p className="text-sm text-gray-600 mt-1">Your check-in code for events you&apos;ve joined</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-start px-6 pt-4 pb-6 gap-3">
        <DigitalCard user={data} qrValue={card?.token?.token ?? null} qrNote={qrNote} />

        <p className="text-xs text-gray-500 text-center max-w-xs leading-relaxed">
          Hosts scan this code at the door to check you in. It only works for
          events you&apos;ve joined. For partner perks, show the live pass below.
        </p>

        <LivePass name={data.name} />

        {stale && (
          <p className="text-xs text-amber-600 text-center max-w-xs leading-relaxed">
            Couldn&apos;t refresh your details just now — this is what your phone
            last saw.
          </p>
        )}
      </div>
    </div>
  )
}
