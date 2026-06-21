'use client'

import { useRef } from 'react'
import QRCode from '@/components/QRCode'
import { resolveImageUrl } from '@/lib/data'

interface Props {
  user: {
    id: string
    name: string
    color: string
    profilePhoto?: string | null
    membershipType?: string
    joinedAt?: string
    neighborhood?: string | null
    interests?: string[]
  }
}

export default function DigitalCard({ user }: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const initials = user.name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  const memberId = user.id.slice(-8).toUpperCase()
  const photo = resolveImageUrl(user.profilePhoto)
  const joinYear = user.joinedAt ? new Date(user.joinedAt).getFullYear() : null
  const qrValue = `smileys:member:${user.id}`
  const c = user.color
  // Membership tier — only premium/vip are worth surfacing; free/standard
  // members get the clean default (no badge).
  const tier = user.membershipType === 'vip' ? 'VIP'
    : user.membershipType === 'premium' ? 'Premium'
    : null

  return (
    <div ref={cardRef} className="w-full max-w-sm mx-auto select-none">
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
        <div className="px-6 pt-6 pb-4 flex flex-col items-center">
          <div
            className="w-28 h-28 rounded-full overflow-hidden flex items-center justify-center"
            style={{
              backgroundColor: c + '14',
              border: `2px solid ${c}22`,
            }}
          >
            {photo ? (
              <img src={photo} alt={user.name} className="w-full h-full object-cover" />
            ) : (
              <span
                className="font-extrabold"
                style={{ color: c, fontSize: '36px', letterSpacing: '-1px' }}
              >
                {initials}
              </span>
            )}
          </div>

          <h2 className="mt-5 text-[22px] font-extrabold text-gray-900 tracking-tight text-center leading-tight">
            {user.name}
          </h2>
          {tier && (
            <span
              className="mt-2 text-[10px] font-bold tracking-[0.18em] uppercase px-2.5 py-1 rounded-full"
              style={{ color: c, backgroundColor: c + '14', border: `1px solid ${c}22` }}
            >
              {tier} Member
            </span>
          )}
          {user.neighborhood && (
            <p className="mt-1 text-[13px] text-gray-400">{user.neighborhood}</p>
          )}
        </div>

        {/* Soft divider */}
        <div className="mx-6 h-px bg-gray-100" />

        {/* QR + ID — clean horizontal split */}
        <div className="px-6 py-5 flex items-center gap-5">
          <div className="shrink-0 rounded-2xl bg-white p-2.5" style={{ border: `1px solid ${c}22` }}>
            <QRCode value={qrValue} size={84} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-gray-400 uppercase mb-1.5">
              Member ID
            </p>
            <p
              className="font-mono text-[15px] font-bold text-gray-800 tracking-[0.15em] mb-3"
            >
              {memberId}
            </p>
            <p className="text-[11px] text-gray-400 leading-snug">
              Scan at events for instant check-in.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
