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

  return (
    <div ref={cardRef} className="w-full max-w-sm mx-auto select-none">
      <div className="relative rounded-3xl overflow-hidden shadow-2xl" style={{ background: `linear-gradient(150deg, ${c}22 0%, #0f172a 45%, #0f172a 100%)` }}>

        {/* Decorative circle pattern (community feel) */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.04 }} aria-hidden>
          <circle cx="85%" cy="15%" r="120" fill="none" stroke="white" strokeWidth="1" />
          <circle cx="85%" cy="15%" r="80" fill="none" stroke="white" strokeWidth="1" />
          <circle cx="85%" cy="15%" r="40" fill="none" stroke="white" strokeWidth="1" />
          <circle cx="15%" cy="90%" r="100" fill="none" stroke="white" strokeWidth="1" />
          <circle cx="15%" cy="90%" r="60" fill="none" stroke="white" strokeWidth="1" />
        </svg>

        {/* Diagonal shine */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'linear-gradient(125deg, rgba(255,255,255,0.07) 0%, transparent 40%, rgba(255,255,255,0.03) 60%, transparent 100%)',
        }} />

        {/* ── Photo / avatar section ── */}
        <div className="relative" style={{ height: '168px' }}>
          {photo ? (
            <img src={photo} alt={user.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center" style={{
              background: `linear-gradient(135deg, ${c}33 0%, ${c}55 50%, #0c1118 100%)`,
            }}>
              <span style={{
                fontFamily: '"Plus Jakarta Sans", Inter, sans-serif',
                fontSize: '56px',
                fontWeight: 900,
                color: c,
                opacity: 0.4,
                letterSpacing: '-2px',
              }}>{initials}</span>
            </div>
          )}

          {/* Gradient fade into card body */}
          <div className="absolute inset-0" style={{
            background: `linear-gradient(to bottom, rgba(12,17,24,0.1) 0%, rgba(12,17,24,0.0) 40%, rgba(12,17,24,0.85) 100%)`,
          }} />

          {/* Color glow at bottom */}
          <div className="absolute bottom-0 left-0 right-0" style={{
            height: '80px',
            background: `radial-gradient(ellipse 70% 60% at 50% 100%, ${c}30 0%, transparent 70%)`,
          }} />

          {/* Logo row */}
          <div className="absolute top-4 left-5 right-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm" style={{
                backgroundColor: 'rgba(255,255,255,0.15)',
                backdropFilter: 'blur(8px)',
                border: '1px solid rgba(255,255,255,0.2)',
              }}>😊</div>
              <span style={{
                fontFamily: '"Plus Jakarta Sans", Inter, sans-serif',
                fontSize: '12px',
                fontWeight: 700,
                color: 'rgba(255,255,255,0.9)',
                letterSpacing: '0.05em',
              }}>Smileys</span>
            </div>
            <div style={{
              fontSize: '9px',
              fontWeight: 700,
              color: 'rgba(255,255,255,0.6)',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              backgroundColor: 'rgba(255,255,255,0.1)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.15)',
              padding: '3px 8px',
              borderRadius: '20px',
            }}>
              {user.membershipType ?? 'Member'}
            </div>
          </div>
        </div>

        {/* ── Identity section ── */}
        <div className="px-6 pt-4 pb-5">
          <p style={{
            fontFamily: '"Plus Jakarta Sans", Inter, sans-serif',
            fontSize: '22px',
            fontWeight: 800,
            color: '#ffffff',
            lineHeight: 1.2,
            letterSpacing: '-0.3px',
            marginBottom: '4px',
          }}>{user.name}</p>

          {user.neighborhood && (
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)', marginBottom: '2px' }}>
              📍 {user.neighborhood}
            </p>
          )}
          {joinYear && (
            <p style={{
              fontSize: '10px',
              color: c + '90',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              marginTop: '6px',
            }}>
              Member since {joinYear}
            </p>
          )}
        </div>

        {/* Separator */}
        <div className="mx-6" style={{ height: '1px', background: `linear-gradient(90deg, ${c}30, rgba(255,255,255,0.08), transparent)` }} />

        {/* ── QR + ID section ── */}
        <div className="px-6 py-5 flex items-end gap-5">
          <div className="flex-1 min-w-0">
            {user.interests && user.interests.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-4">
                {user.interests.slice(0, 3).map(i => (
                  <span key={i} style={{
                    fontSize: '10px',
                    color: 'rgba(255,255,255,0.5)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: '2px 8px',
                    borderRadius: '20px',
                    textTransform: 'capitalize',
                  }}>{i}</span>
                ))}
              </div>
            )}
            <p style={{ fontSize: '9px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '4px' }}>
              Member ID
            </p>
            <p style={{
              fontFamily: '"Courier New", monospace',
              fontSize: '13px',
              fontWeight: 700,
              letterSpacing: '0.22em',
              color: c + 'cc',
            }}>{memberId}</p>
          </div>

          <div className="shrink-0 text-center">
            <div style={{
              background: 'rgba(255,255,255,0.95)',
              borderRadius: '16px',
              padding: '10px',
              boxShadow: `0 0 20px ${c}25`,
            }}>
              <QRCode value={qrValue} size={88} />
            </div>
            <p style={{ fontSize: '9px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '6px' }}>
              Scan to verify
            </p>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-3 flex items-center justify-between" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.2)', letterSpacing: '0.04em' }}>
            smileyscommunity.com
          </p>
          <p style={{ fontSize: '10px', fontWeight: 600, color: c + '99', letterSpacing: '0.08em' }}>
            ✦ Member
          </p>
        </div>

      </div>
    </div>
  )
}
