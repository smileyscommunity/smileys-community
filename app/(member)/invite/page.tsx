'use client'

import { toast } from 'sonner'
import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { SITE_URL } from '@/lib/env'
import { resolveImageUrl } from '@/lib/data'
import { useHomeCity } from '@/hooks/useHomeCity'
import { CITY_MATURITY } from '@/lib/cityMaturity'
import { CITY_STATUS } from '@/lib/cityStatus'

const QRCode = dynamic(() => import('@/components/QRCode'), { ssr: false })

interface JoinedMember {
  id: string; name: string; color: string; profilePhoto: string | null
  joinedAt: string | null
  /** False when their profile is locked to this viewer (connections only). */
  open?: boolean
}

interface Stats {
  code: string
  referralCount: number
  pending: number
  approved: number
  joined: JoinedMember[]
}

interface PublicCity { slug: string; name: string; status: string; maturity: string | null }

// What the friend is told depends on where the city is. Sailing trips and
// "always something happening" are Istanbul's story; a city still gathering
// its first members, or not open yet, gets an honest version of the ask.
function inviteText(city: PublicCity, url: string, paragraphBreak: string): string {
  const who = 'expats, digital nomads, frequent travelers, and global-minded locals'
  if (city.status === CITY_STATUS.Live && city.maturity === CITY_MATURITY.SelfSustaining) {
    return `Hey! I think you'd really enjoy Smileys Community — a curated social community in ${city.name} where ${who} connect through events, clubs, and real friendships.${paragraphBreak}From social nights and dinners to sailing trips, hiking, language meetups, wellness activities, and networking events, there's always something happening and new people to meet.${paragraphBreak}You can apply here:\n${url}`
  }
  if (city.status === CITY_STATUS.Live) {
    return `Hey! Smileys Community is just getting started in ${city.name} — a curated social community where ${who} meet through hosted events and clubs. The first members are shaping what it becomes, and I think you'd enjoy being one of them.${paragraphBreak}You can apply here:\n${url}`
  }
  return `Hey! Smileys Community is opening in ${city.name} — a curated social community where ${who} meet through hosted events and clubs. You can apply now and be one of its founding members:\n${url}`
}

export default function InvitePage() {
  // The invite goes to a city the member CHOOSES, starting from their home
  // city. It used to follow whatever city they had last browsed (the
  // view-city cookie), with no sign of it on the page, and it said
  // "Istanbul" until that lookup answered.
  const { home, loading: homeLoading } = useHomeCity()
  const [cities,    setCities]    = useState<PublicCity[]>([])
  const [inviteSlug, setInviteSlug] = useState('')
  const [stats,   setStats]   = useState<Stats | null>(null)
  const [failed,  setFailed]  = useState(false)
  const [copied,  setCopied]  = useState(false)
  const [loading, setLoading] = useState(true)

  const loadStats = useCallback(() => {
    setLoading(true)
    setFailed(false)
    fetch('/app/api/invite', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.code) setStats(d); else setFailed(true) })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  useEffect(() => {
    fetch('/app/api/cities')
      .then(r => (r.ok ? r.json() : null))
      .then((d: PublicCity[] | null) => {
        if (!Array.isArray(d)) return
        const rank = (st: string) => (st === CITY_STATUS.Live ? 0 : st === CITY_STATUS.Preparing ? 1 : 2)
        setCities([...d].sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name)))
      })
      .catch(() => {})
  }, [])

  // Start from the home city once both answers are in; a member's own pick wins.
  useEffect(() => {
    if (inviteSlug || !cities.length) return
    if (home && cities.some(c => c.slug === home.slug)) setInviteSlug(home.slug)
    else if (!homeLoading) setInviteSlug(cities.find(c => c.status === CITY_STATUS.Live)?.slug ?? cities[0].slug)
  }, [home, homeLoading, cities, inviteSlug])

  const inviteCity = cities.find(c => c.slug === inviteSlug) ?? null
  const inviteUrl = stats && inviteCity
    ? `${typeof window !== 'undefined' ? window.location.origin : SITE_URL}/app/apply?ref=${stats.code}&city=${inviteCity.slug}`
    : ''

  async function copyLink() {
    if (!inviteUrl) return
    // Clipboard writes reject in some in-app browsers / non-secure
    // contexts — don't flash "Copied!" over a failed write.
    try {
      await navigator.clipboard.writeText(inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy — long-press the link to copy it manually')
    }
  }

  function shareWhatsApp() {
    if (!inviteUrl || !inviteCity) return
    window.open(`https://wa.me/?text=${encodeURIComponent(inviteText(inviteCity, inviteUrl, '\n'))}`, '_blank')
  }

  function shareEmail() {
    if (!inviteUrl || !inviteCity) return
    const subject = encodeURIComponent(`Join Smileys Community in ${inviteCity.name}`)
    const body = encodeURIComponent(inviteText(inviteCity, inviteUrl, '\n\n'))
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-warm flex items-center justify-center">
        <div role="status" aria-label="Loading your invite link" className="w-8 h-8 rounded-full border-2 border-amber-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  const joined      = stats?.joined ?? []
  const notListed   = Math.max(0, (stats?.approved ?? 0) - joined.length)

  return (
    <div className="min-h-screen bg-warm pb-24 md:pb-8">
      {/* Hero */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-6">
          <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">Referrals</span>
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900 mb-2">Invite Friends</h1>
          <p className="text-base text-gray-600 max-w-md">
            Know someone who&apos;d love Smileys? Share your personal invite link. Your referrals help us keep the community quality high.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
      <div className="max-w-lg space-y-5">
        {/* A failed load used to leave an empty link that still "copied",
            a WhatsApp message with no link, and a QR spinner forever. */}
        {failed || !stats ? (
          <div role="alert" className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center">
            <p className="font-bold text-gray-900 mb-1">We couldn&apos;t load your invite link</p>
            <p className="text-sm text-gray-600 mb-4">Check your connection and try again.</p>
            <button onClick={loadStats} className="btn-primary text-sm">Try again</button>
          </div>
        ) : (
        <>
        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <p className="text-3xl font-extrabold text-amber-600">{stats.approved}</p>
            <p className="text-xs text-gray-600 mt-1 font-medium">Friends joined</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <p className="text-3xl font-extrabold text-gray-700">{stats.pending}</p>
            <p className="text-xs text-gray-600 mt-1 font-medium">Applications in review</p>
          </div>
        </div>

        {/* Invite link card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <label htmlFor="invite-city" className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Inviting a friend to</label>
          <select id="invite-city" value={inviteSlug} onChange={e => setInviteSlug(e.target.value)} className="input mb-4">
            {!inviteSlug && <option value="">Choose a city…</option>}
            {cities.map(c => (
              <option key={c.slug} value={c.slug}>
                {c.name}{c.status === CITY_STATUS.Live ? '' : ' (opening soon)'}{home?.slug === c.slug ? ' — your city' : ''}
              </option>
            ))}
          </select>

          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Your invite link</p>
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 mb-4">
            <span className="flex-1 text-sm text-gray-700 font-mono truncate">{inviteUrl || 'Choose a city to get your link'}</span>
            <button
              onClick={copyLink}
              disabled={!inviteUrl}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
                copied ? 'bg-green-100 text-green-700' : 'bg-amber-500 text-white hover:bg-amber-600'
              }`}
            >
              {copied ? <><span aria-hidden="true">✓ </span>Copied!</> : 'Copy'}
            </button>
          </div>
          {/* Announced to screen readers — the button's label change alone isn't. */}
          <p className="sr-only" aria-live="polite">{copied ? 'Invite link copied' : ''}</p>

          {/* Share buttons */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={shareWhatsApp}
              disabled={!inviteUrl}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-[#25D366] hover:bg-[#1ebe5d] text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              <svg aria-hidden="true" className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              WhatsApp
            </button>
            <button
              onClick={shareEmail}
              disabled={!inviteUrl}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
            >
              <svg aria-hidden="true" className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Email
            </button>
          </div>
        </div>

        {/* QR code */}
        {inviteUrl && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-4">QR code</p>
            <div className="flex flex-col items-start gap-3">
              <div role="img" aria-label={`QR code for your invite link to ${inviteCity?.name ?? 'Smileys'}`} className="p-3 bg-white rounded-xl border border-gray-100 shadow-sm">
                <QRCode value={inviteUrl} size={180} />
              </div>
              <p className="text-xs text-gray-500">
                Show this to a friend or screenshot it to share
              </p>
            </div>
          </div>
        )}

        {/* Who you invited */}
        {stats.approved > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-4">People you brought in</p>
            <ul className="space-y-3">
              {joined.map(m => {
                const photo = resolveImageUrl(m.profilePhoto)
                const initials = m.name.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
                const body = (
                  <>
                    {photo ? (
                      <img src={photo} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                    ) : (
                      <div aria-hidden="true" className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
                        style={{ backgroundColor: m.color }}>{initials}</div>
                    )}
                    <p className="flex-1 min-w-0 text-sm font-semibold text-gray-900 truncate">{m.name}</p>
                  </>
                )
                return (
                  <li key={m.id}>
                    {/* A connections-only profile is locked to you, so it isn't a link. */}
                    {m.open === false
                      ? <div className="flex items-center gap-3">{body}</div>
                      : <Link href={`/members/${m.id}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">{body}</Link>}
                  </li>
                )
              })}
            </ul>
            {notListed > 0 && (
              <p className="text-xs text-gray-500 mt-4">
                {joined.length > 0 ? 'Plus ' : ''}{notListed} {notListed === 1 ? 'person' : 'people'} who {notListed === 1 ? 'is' : 'are'} no longer listed on Smileys.
              </p>
            )}
          </div>
        )}

        {/* How it works */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-4">How it works</p>
          <ol className="space-y-3">
            {[
              { step: '1', text: 'Share your unique link with friends', icon: '🔗' },
              { step: '2', text: 'They apply using your link and confirm their email', icon: '📝' },
              { step: '3', text: 'Our team reviews their application', icon: '👀' },
              { step: '4', text: 'If approved, they join the community!', icon: '🎉' },
            ].map(({ step, text, icon }) => (
              <li key={step} className="flex items-center gap-3">
                <div aria-hidden="true" className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center shrink-0">
                  {step}
                </div>
                <span className="text-sm text-gray-600"><span aria-hidden="true">{icon} </span>{text}</span>
              </li>
            ))}
          </ol>
        </div>

        <p className="text-xs text-gray-500 pb-2">
          Your invite code: <span className="font-mono font-semibold text-gray-700">{stats.code}</span>
        </p>
        </>
        )}
      </div>
      </div>
    </div>
  )
}
