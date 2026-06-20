'use client'

'use client'

import { useState, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { SITE_URL } from '@/lib/env'
import { resolveImageUrl } from '@/lib/data'

const QRCode = dynamic(() => import('@/components/QRCode'), { ssr: false })

interface JoinedMember {
  id: string; name: string; color: string; profilePhoto: string | null
  neighborhood: string | null; joinedAt: string | null
}

interface Stats {
  code: string
  referralCount: number
  pending: number
  approved: number
  joined: JoinedMember[]
}

export default function InvitePage() {
  const [stats,   setStats]   = useState<Stats | null>(null)
  const [copied,  setCopied]  = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/app/api/invite', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false) })
  }, [])

  const inviteUrl = stats ? `${typeof window !== 'undefined' ? window.location.origin : SITE_URL}/app/apply?ref=${stats.code}` : ''

  function copyLink() {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function shareWhatsApp() {
    const text = `Hey! I think you'd really enjoy Smileys Community — a curated social community in Istanbul where expats, digital nomads, frequent travelers, and global-minded locals connect through events, clubs, and real friendships.\nFrom social nights and dinners to sailing trips, hiking, language meetups, wellness activities, and networking events, there's always something happening and new people to meet.\nYou can apply here:\n${inviteUrl}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  function shareEmail() {
    const subject = encodeURIComponent("Join Smileys Community in Istanbul!")
    const body = encodeURIComponent(`Hey! I think you'd really enjoy Smileys Community — a curated social community in Istanbul where expats, digital nomads, frequent travelers, and global-minded locals connect through events, clubs, and real friendships.\n\nFrom social nights and dinners to sailing trips, hiking, language meetups, wellness activities, and networking events, there's always something happening and new people to meet.\n\nYou can apply here:\n${inviteUrl}`)
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-warm flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-warm pb-24 md:pb-8">
      {/* Hero */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-6">
          <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">Referrals</span>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900 mb-2">Invite Friends</h1>
          <p className="text-base text-gray-600 max-w-md">
            Know someone who'd love Smileys? Share your personal invite link. Your referrals help us keep the community quality high.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
      <div className="max-w-lg space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <p className="text-3xl font-extrabold text-amber-500">{stats?.approved ?? 0}</p>
            <p className="text-xs text-gray-600 mt-1 font-medium">Friends joined</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <p className="text-3xl font-extrabold text-gray-700">{stats?.pending ?? 0}</p>
            <p className="text-xs text-gray-600 mt-1 font-medium">Applications pending</p>
          </div>
        </div>

        {/* Invite link card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Your invite link</p>
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 mb-4">
            <span className="flex-1 text-sm text-gray-700 font-mono truncate">{inviteUrl}</span>
            <button
              onClick={copyLink}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                copied ? 'bg-green-100 text-green-700' : 'bg-amber-500 text-white hover:bg-amber-600'
              }`}
            >
              {copied ? '✓ Copied!' : 'Copy'}
            </button>
          </div>

          {/* Share buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={shareWhatsApp}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-[#25D366] hover:bg-[#1ebe5d] text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              WhatsApp
            </button>
            <button
              onClick={shareEmail}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl transition-colors"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Email
            </button>
          </div>
        </div>

        {/* QR code */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-4">QR code</p>
          <div className="flex flex-col items-start gap-3">
            <div className="p-3 bg-white rounded-xl border border-gray-100 shadow-sm">
              {inviteUrl ? <QRCode value={inviteUrl} size={180} /> : <div className="w-[180px] h-[180px] bg-gray-100 rounded-xl animate-pulse" />}
            </div>
            <p className="text-xs text-gray-400">
              Show this to a friend or screenshot it to share
            </p>
          </div>
        </div>

        {/* Who you invited */}
        {(stats?.joined?.length ?? 0) > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-4">People you brought in</p>
            <div className="space-y-3">
              {stats!.joined.map(m => {
                const photo = resolveImageUrl(m.profilePhoto)
                const initials = m.name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
                return (
                  <Link key={m.id} href={`/members/${m.id}`}
                    className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                    {photo ? (
                      <img src={photo} alt={m.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: m.color }}>{initials}</div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{m.name}</p>
                      {m.neighborhood && <p className="text-xs text-gray-400 truncate">📍 {m.neighborhood}</p>}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-4">How it works</p>
          <div className="space-y-3">
            {[
              { step: '1', text: 'Share your unique link with friends', icon: '🔗' },
              { step: '2', text: 'They apply using your link', icon: '📝' },
              { step: '3', text: 'Our team reviews their application', icon: '👀' },
              { step: '4', text: 'If approved, they join the community!', icon: '🎉' },
            ].map(({ step, text, icon }) => (
              <div key={step} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center shrink-0">
                  {step}
                </div>
                <span className="text-sm text-gray-600">{icon} {text}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-gray-400 pb-2">
          Your invite code: <span className="font-mono font-semibold text-gray-600">{stats?.code}</span>
        </p>
      </div>
      </div>
    </div>
  )
}
