'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import posthog from 'posthog-js'
import AvatarImg from '@/components/AvatarImg'
import { avatarUrl } from '@/lib/data'

interface DiscoveryMember {
  id: string; name: string; color: string; profilePhoto: string | null
  neighborhood: string | null; interests: string[]; isHost: boolean
  context: { label: string | null; clubs: { id: string; name: string; emoji: string; slug: string }[] } | null
}

interface Discovery {
  mightMeet: DiscoveryMember[]
  clubMates: DiscoveryMember[]
  neighbours: DiscoveryMember[]
  eventMates: DiscoveryMember[]
  newcomers: DiscoveryMember[]
  hosts: DiscoveryMember[]
  viewer: { neighborhood: string | null; hasClubs: boolean }
}

// Member card (§8) — photo, first name, neighborhood, a couple of
// interests and the shared-context line. Deliberately no age, no
// distance, no counts (§9).
function MemberCard({ m, onOpen }: { m: DiscoveryMember; onOpen: (id: string) => void }) {
  return (
    <Link href={`/members/${m.id}`} onClick={() => onOpen(m.id)}
      // Same scroller leftover as the events tile: w-44 pinned each card to
      // 11rem inside a grid cell that is half the screen on a phone.
      className="w-full bg-white border border-gray-100 rounded-2xl p-4 shadow-sm hover:shadow-md hover:border-amber-200 hover:-translate-y-0.5 transition-all group">
      <AvatarImg src={avatarUrl(m.profilePhoto, 256)} name={m.name} color={m.color}
        size="w-16 h-16" textSize="text-lg" className="mb-3" />
      <p className="font-bold text-gray-900 text-sm truncate group-hover:text-amber-700 transition-colors">
        {m.name.split(' ')[0]}
        {m.isHost && <span className="ml-1.5 text-[10px] font-bold text-amber-600 align-middle">HOST</span>}
      </p>
      {m.neighborhood && <p className="text-xs text-gray-500 mt-0.5 truncate"><span aria-hidden="true">📍</span> {m.neighborhood}</p>}
      {m.interests.length > 0 && (
        <p className="text-[11px] text-gray-400 mt-1.5 truncate">{m.interests.join(' · ')}</p>
      )}
      {m.context?.label && (
        <p className="text-[11px] font-semibold text-amber-700 mt-2 line-clamp-2">{m.context.label}</p>
      )}
    </Link>
  )
}

function Section({ title, subtitle, members, cta, onOpen }: {
  title: string; subtitle?: string; members: DiscoveryMember[]
  cta?: { href: string; label: string }
  onOpen: (id: string) => void
}) {
  if (members.length === 0) return null
  return (
    <div className="mb-8">
      <div className="flex items-end justify-between gap-4 mb-3">
        <div>
          <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-gray-900">{title}</h2>
          {subtitle && <p className="text-sm text-gray-600 mt-0.5">{subtitle}</p>}
        </div>
        {/* Desktop only — same rule as the events rail: on a phone this sat in
            the heading row taking width from the title, and every destination
            it points at is a tap away in the nav. */}
        {cta && (
          <Link href={cta.href} className="hidden sm:inline text-xs font-bold text-amber-600 hover:text-amber-700 shrink-0">
            {cta.label}
          </Link>
        )}
      </div>
      {/* Horizontal scroll on mobile, grid on desktop (§49). */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pb-2">
        {members.map(m => <MemberCard key={m.id} m={m} onOpen={onOpen} />)}
      </div>
    </div>
  )
}

// Contextual discovery (Members brief §5–6/§51) — the sections that sit
// above "Explore the Community". Client island so the existing members
// page keeps its architecture; one fetch serves every section.
export default function MemberDiscovery() {
  const [d, setD] = useState<Discovery | null>(null)

  useEffect(() => {
    fetch('/app/api/members/discovery', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(setD)
      .catch(() => {})
  }, [])

  if (!d) return null

  const onOpen = (id: string) => posthog.capture('member_viewed', { from: 'discovery', memberId: id })
  const nothingContextual =
    d.mightMeet.length === 0 && d.clubMates.length === 0 && d.neighbours.length === 0 && d.eventMates.length === 0

  return (
    <div>
      <Section title="People you might meet"
        subtitle="Through the clubs, plans and places you share."
        members={d.mightMeet} onOpen={onOpen} />

      <Section title="In your clubs" members={d.clubMates}
        cta={{ href: '/clubs', label: 'Explore your clubs →' }} onOpen={onOpen} />

      {d.viewer.neighborhood
        ? <Section title={`Around ${d.viewer.neighborhood}`}
            // "your neighborhood", not "your part of Istanbul" — this rail
            // renders for every city.
            subtitle="People in and around your neighborhood."
            members={d.neighbours}
            cta={{ href: '/neighborhoods', label: 'Explore neighborhoods →' }} onOpen={onOpen} />
        : (
          <div className="mb-8 bg-amber-50 border border-amber-100 rounded-2xl p-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="font-bold text-gray-900">Find people around you</p>
              <p className="text-sm text-gray-600 mt-0.5">Choose your Istanbul neighborhood to discover your local community.</p>
            </div>
            <Link href="/profile" className="shrink-0 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
              Choose neighborhood
            </Link>
          </div>
        )}

      <Section title="Going where you're going"
        subtitle="People joining the same plans as you."
        members={d.eventMates}
        cta={{ href: '/events', label: 'See events →' }} onOpen={onOpen} />

      <Section title="Say hello to someone new 👋" members={d.newcomers} onOpen={onOpen} />

      <Section title="Meet the people making things happen" members={d.hosts} onOpen={onOpen} />

      {/* §44 — empty state that points somewhere, never "no members found". */}
      {nothingContextual && (
        <div className="mb-8 bg-gray-50 border border-gray-200 rounded-2xl p-6 text-center">
          <p className="font-bold text-gray-900">Your circle starts with what you&apos;re into.</p>
          <p className="text-sm text-gray-600 mt-1 mb-4">
            Join a club or pick some interests and we&apos;ll show you people you may actually meet.
          </p>
          <Link href="/clubs" className="inline-block px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
            Explore clubs →
          </Link>
        </div>
      )}
    </div>
  )
}
