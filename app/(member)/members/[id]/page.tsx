'use client'

import { useEffect, useState, use, useRef } from 'react'
import Link from 'next/link'
import { resolveImageUrl, getInitials, formatDate } from '@/lib/data'
import { countryFlag } from '@/lib/countries'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { SkeletonCard, SkeletonCircle, SkeletonLine } from '@/components/Skeleton'
import posthog from 'posthog-js'

interface HostClub {
  id: string
  name: string
  emoji: string
  slug: string
  bgColor: string
}

interface UpcomingEvent {
  id: string
  title: string
  date: string
  time: string
  neighborhood: string
  emoji: string
  coverImage: string | null
}

interface MemberProfile {
  id: string
  name: string
  color: string
  bio: string | null
  neighborhood: string | null
  nationality: string | null
  interests: string[]
  languages: string[]
  profilePhoto: string | null
  joinedAt: string | null
  role: string
  instagram: string | null
  clubs: HostClub[]
  upcomingEvents: UpcomingEvent[]
  isConnected: boolean
  connectionId: string | null
  connectionStatus: string | null
  connectionIsRequester: boolean | null
  // Hangout activity — used for the "X hosted · Y joined" counter line
  // and the "✓ N good hangouts" trust badge.
  goodHangouts?: number
  hangoutsHosted?: number
  hangoutsJoined?: number
  // Count of members this person brought in via referral — drives the
  // "🤝 Brought in N members" trust badge. Server omits when zero.
  broughtInCount?: number
}

export default function MemberProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user: me } = useAuth()
  const [member,       setMember]       = useState<MemberProfile | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [blocked,      setBlocked]      = useState(false)
  const [blocking,     setBlocking]     = useState(false)
  const [connecting,   setConnecting]   = useState(false)
  const [connStatus,   setConnStatus]   = useState<string | null>(null)
  const [connId,       setConnId]       = useState<string | null>(null)
  const [connIsReq,    setConnIsReq]    = useState<boolean | null>(null)
  const [menuOpen,     setMenuOpen]     = useState(false)
  const [reporting,    setReporting]    = useState(false)
  const [reportSent,   setReportSent]   = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportNote,   setReportNote]   = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch(`/app/api/members/${id}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setMember(data)
        if (data) {
          setConnStatus(data.connectionStatus)
          setConnId(data.connectionId)
          setConnIsReq(data.connectionIsRequester)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id])

  useEffect(() => {
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-warm pb-20">
        <div className="bg-white border-b border-gray-100 h-12 sticky top-0 z-10" />
        <div className="max-w-2xl mx-auto px-4 pt-6 space-y-4">
          <div className="bg-white rounded-2xl shadow-card p-6 animate-pulse">
            <div className="flex items-center gap-4 mb-5">
              <SkeletonCircle className="w-20 h-20 shrink-0" />
              <div className="flex-1 space-y-2">
                <SkeletonLine className="h-5 w-2/3" />
                <SkeletonLine className="h-3 w-1/2" />
                <SkeletonLine className="h-3 w-1/3" />
              </div>
            </div>
            <div className="space-y-2">
              <SkeletonLine className="h-3 w-full" />
              <SkeletonLine className="h-3 w-4/5" />
              <SkeletonLine className="h-3 w-3/5" />
            </div>
          </div>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    )
  }

  if (!member) {
    return (
      <div className="min-h-screen bg-warm flex flex-col items-center justify-center gap-3 text-center px-4">
        <p className="text-2xl">🤷</p>
        <p className="font-semibold text-gray-800">Member not found</p>
        <Link href="/members" className="text-sm text-amber-600 hover:underline">← Back to members</Link>
      </div>
    )
  }

  const initials      = getInitials(member.name)
  const flag          = countryFlag(member.nationality)
  const isOwnProfile  = me?.id === member.id
  const isAccepted       = connStatus === 'accepted'
  // Role-based messaging — admin / moderator / club host can DM any
  // member regardless of connection state. Used to suppress the
  // Connect button for these roles (they don't need to send a
  // request to reach the inbox).
  const canMessageByRole = !isOwnProfile && (me?.role === 'admin' || me?.role === 'moderator' || me?.isClubHost === true)
  const canMessage       = !isOwnProfile && (isAccepted || canMessageByRole)

  async function handleConnect() {
    if (connecting) return
    setConnecting(true)
    try {
      if (connStatus === 'pending' && connIsReq) {
        // Withdraw pending request
        await fetch(`/app/api/connections/${connId}`, { method: 'DELETE', credentials: 'include' })
        setConnStatus(null); setConnId(null); setConnIsReq(null)
        toast.success('Request withdrawn.')
      } else {
        const res = await fetch('/app/api/connections', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ receiverId: member!.id }),
        })
        const data = await res.json()
        if (res.ok) {
          setConnId(data.connection.id)
          setConnStatus(data.connection.status)
          setConnIsReq(true)
          if (data.connection.status === 'accepted') {
            toast.success(`Connected with ${member!.name.split(' ')[0]}!`)
          } else {
            toast.success('Connection request sent!')
          }
        } else {
          toast.error(data.error || 'Could not send request')
        }
      }
    } finally {
      setConnecting(false)
    }
  }

  // Receiver-side accept/decline — the same affordance lives in the
  // notification, but a member who lands on the profile directly
  // (deep link, search, club page) should be able to act in place
  // without bouncing through the inbox.
  async function handleRespondToRequest(action: 'accept' | 'decline') {
    if (connecting || !connId) return
    setConnecting(true)
    try {
      const res = await fetch(`/app/api/connections/${connId}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Could not update request')
        return
      }
      if (action === 'accept') {
        setConnStatus('accepted')
        toast.success(`Connected with ${member!.name.split(' ')[0]}!`)
      } else {
        // Decline deletes the row server-side — clear local state to
        // mirror that. The Connect button re-appears, which is
        // intentional: declining is reversible by sending a fresh
        // request.
        setConnStatus(null); setConnId(null); setConnIsReq(null)
        toast('Request declined')
      }
    } finally {
      setConnecting(false)
    }
  }

  async function handleBlock() {
    if (!confirm(`Block ${member!.name}? They won't be able to see your profile or message you.`)) return
    setBlocking(true)
    const res = await fetch('/app/api/members/block', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: member!.id }),
    })
    setBlocking(false)
    if (res.ok) { setBlocked(true); toast.success(`${member!.name} has been blocked.`) }
  }

  async function handleUnblock() {
    setBlocking(true)
    const res = await fetch('/app/api/members/block', {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: member!.id }),
    })
    setBlocking(false)
    if (res.ok) { setBlocked(false); toast.success('Unblocked.') }
  }

  async function handleReport(e: React.FormEvent) {
    e.preventDefault()
    if (!reportReason) return
    await fetch('/app/api/reports', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportedId: member!.id, reason: reportReason, details: reportNote }),
    })
    posthog.capture('member_reported', { reported_member_id: member!.id, reason: reportReason })
    setReportSent(true)
  }

  return (
    <div className="min-h-screen bg-warm pb-20">
      {/* Back nav */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/members" className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <span className="font-semibold text-gray-900 text-sm truncate flex-1">{member.name.split(' ')[0]}'s Profile</span>
          {isOwnProfile ? (
            <Link href="/profile" className="text-xs text-amber-600 font-semibold hover:underline">Edit</Link>
          ) : (
            <div className="flex items-center gap-2">
              {/* Connect / Message primary CTA lives in the big row
                  below the profile card. The header keeps only the
                  ⋯ overflow menu (report / block) so the same
                  affordance isn't rendered in two places. */}
              {/* ⋯ actions menu */}
              <div className="relative" ref={menuRef}>
                <button onClick={() => setMenuOpen(o => !o)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                  aria-label="More options">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
                  </svg>
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-44 bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden z-50">
                    <button
                      onClick={() => { setMenuOpen(false); setReporting(true) }}
                      className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left">
                      <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                      </svg>
                      Report
                    </button>
                    <div className="h-px bg-gray-100" />
                    <button
                      onClick={() => { setMenuOpen(false); if (!blocking) { blocked ? handleUnblock() : handleBlock() } }}
                      disabled={blocking}
                      className="w-full flex items-center gap-2.5 px-4 py-3 text-sm text-red-500 hover:bg-red-50 transition-colors text-left disabled:opacity-50">
                      <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                      </svg>
                      {blocked ? 'Unblock' : 'Block'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Report sheet */}
      {reporting && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4 pb-4 sm:pb-0">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-6">
            {reportSent ? (
              <div className="text-center py-4">
                <p className="text-2xl mb-3">✅</p>
                <p className="font-bold text-gray-900">Report submitted</p>
                <p className="text-sm text-gray-500 mt-1">Our team will review it shortly.</p>
                <button onClick={() => { setReporting(false); setReportSent(false) }}
                  className="mt-5 w-full py-2.5 rounded-xl bg-gray-100 text-sm font-semibold text-gray-700 hover:bg-gray-200 transition-colors">
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleReport}>
                <h2 className="font-bold text-gray-900 mb-1">Report {member.name.split(' ')[0]}</h2>
                <p className="text-xs text-gray-400 mb-4">Reports are anonymous and reviewed by our team.</p>
                <div className="space-y-3">
                  <select required value={reportReason} onChange={e => setReportReason(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                    <option value="">Select a reason…</option>
                    <option value="harassment">Harassment or bullying</option>
                    <option value="spam">Spam or fake profile</option>
                    <option value="inappropriate">Inappropriate content</option>
                    <option value="scam">Scam or fraud</option>
                    <option value="other">Other</option>
                  </select>
                  <textarea value={reportNote} onChange={e => setReportNote(e.target.value)}
                    placeholder="Optional details…" rows={3}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
                <div className="flex gap-2 mt-4">
                  <button type="button" onClick={() => setReporting(false)}
                    className="flex-1 py-2.5 rounded-xl bg-gray-100 text-sm font-semibold text-gray-700 hover:bg-gray-200 transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={!reportReason}
                    className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-semibold transition-colors disabled:opacity-40">
                    Submit report
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-5">
        {/* Avatar + name */}
        <div className="bg-white rounded-2xl shadow-card p-6 flex items-center gap-5">
          <div className="w-20 h-20 rounded-2xl shrink-0 overflow-hidden flex items-center justify-center text-2xl font-bold text-white"
            style={{ backgroundColor: member.color }}>
            {member.profilePhoto
              ? <img src={resolveImageUrl(member.profilePhoto)} alt={member.name} className="w-full h-full object-cover" />
              : initials
            }
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">{member.name}</h1>
              {flag && <span className="text-lg">{flag}</span>}
              {member.role === 'admin' && (
                <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Admin</span>
              )}
              {member.role === 'moderator' && (
                <span className="text-xs font-semibold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Mod</span>
              )}
              {member.clubs.length > 0 && (
                <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Host</span>
              )}
              {!isOwnProfile && isAccepted && (
                <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  Connected
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-3 text-sm text-gray-500">
              {member.neighborhood && <span>📍 {member.neighborhood}</span>}
              {member.joinedAt && <span>Joined {new Date(member.joinedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>}
            </div>
            {/* Hangout counter — surfaces social-proof for the spontaneous
                meetup signal. Hidden entirely when this member has zero
                history so newcomers don't read absence as a red flag.
                Referral badge sits in the same row — same hide-when-zero
                contract so non-inviters don't get shamed. */}
            {((member.hangoutsHosted ?? 0) + (member.hangoutsJoined ?? 0) > 0 || (member.goodHangouts ?? 0) > 0 || (member.broughtInCount ?? 0) > 0) && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {(member.hangoutsHosted ?? 0) > 0 && (
                  <span className="text-xs text-gray-600 font-medium">☕ {member.hangoutsHosted} hosted</span>
                )}
                {(member.hangoutsJoined ?? 0) > 0 && (
                  <span className="text-xs text-gray-600 font-medium">· {member.hangoutsJoined} joined</span>
                )}
                {(member.goodHangouts ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-semibold border border-green-200">
                    ✓ {member.goodHangouts} good
                  </span>
                )}
                {(member.broughtInCount ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200" title="Members this person brought in via referral">
                    🤝 Brought in {member.broughtInCount}
                  </span>
                )}
              </div>
            )}
            {member.instagram && (
              <a href={`https://instagram.com/${member.instagram.replace('@', '')}`}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-2 text-xs text-pink-600 hover:underline font-medium">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
                </svg>
                @{member.instagram.replace('@', '')}
              </a>
            )}
          </div>
        </div>

        {/* Connect / Message CTA — prominent row below the profile
            card. Three branches:
            • Incoming pending (you're the receiver) → Accept + Decline
            • Outgoing pending (you sent it)         → Requested · tap to withdraw
            • No connection                          → Connect
            Admin / moderator / club host always see Message (their
            inbox isn't gated by connection state) — Connect is
            suppressed because they don't need to send a request to
            reach the DM. */}
        {!isOwnProfile && (
          <div className="flex gap-3">
            {/* A — incoming pending: receiver acts in-place */}
            {connStatus === 'pending' && connIsReq === false && (
              <>
                <button
                  onClick={() => handleRespondToRequest('accept')}
                  disabled={connecting}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-2xl transition-colors shadow-sm disabled:opacity-60">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Accept
                </button>
                <button
                  onClick={() => handleRespondToRequest('decline')}
                  disabled={connecting}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-bold rounded-2xl transition-colors shadow-sm disabled:opacity-60">
                  Decline
                </button>
              </>
            )}

            {/* B — Connect / Requested — hidden for admin/mod/host
                (they can already message), and for the receiver-pending
                state handled above. */}
            {!isAccepted && !canMessageByRole && (connStatus !== 'pending' || connIsReq) && (
              <button
                onClick={handleConnect}
                disabled={connecting}
                className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-bold rounded-2xl transition-colors shadow-sm disabled:opacity-60 ${
                  connStatus === 'pending'
                    ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    : 'bg-amber-500 hover:bg-amber-600 text-white'
                }`}>
                {connStatus === 'pending' ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Request sent — tap to withdraw
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                    Connect
                  </>
                )}
              </button>
            )}

            {/* C — Message — connected, or role-based bypass. */}
            {(isAccepted || canMessageByRole) && (
              <Link href={`/messages/${member.id}`}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-2xl transition-colors shadow-sm">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                Message
              </Link>
            )}
          </div>
        )}

        {/* Bio */}
        {member.bio && (
          <div className="bg-white rounded-2xl shadow-card p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">About</p>
            <p className="text-sm text-gray-700 leading-relaxed">{member.bio}</p>
          </div>
        )}

        {/* Interests + languages */}
        {(member.interests.length > 0 || member.languages.length > 0) && (
          <div className="bg-white rounded-2xl shadow-card p-5 space-y-4">
            {member.interests.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Interests</p>
                <div className="flex flex-wrap gap-1.5">
                  {member.interests.map(i => (
                    <span key={i} className="text-xs bg-amber-50 text-amber-700 border border-amber-100 px-2.5 py-1 rounded-full font-medium">{i}</span>
                  ))}
                </div>
              </div>
            )}
            {member.languages.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Languages</p>
                <div className="flex flex-wrap gap-1.5">
                  {member.languages.map(l => (
                    <span key={l} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full font-medium">{l}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Host clubs */}
        {member.clubs.length > 0 && (
          <div className="bg-white rounded-2xl shadow-card p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Hosts in</p>
            <div className="space-y-2">
              {member.clubs.map(club => (
                <Link key={club.id} href={`/clubs/${club.slug}`}
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors group">
                  <div className={`w-10 h-10 rounded-xl ${club.bgColor} flex items-center justify-center text-xl shrink-0`}>{club.emoji}</div>
                  <span className="text-sm font-semibold text-gray-800 group-hover:text-amber-600 transition-colors">{club.name}</span>
                  <svg className="w-4 h-4 text-gray-300 ml-auto shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Upcoming events */}
        {member.upcomingEvents.length > 0 && (
          <div className="bg-white rounded-2xl shadow-card p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Upcoming events</p>
            <div className="space-y-2">
              {member.upcomingEvents.map(ev => (
                <Link key={ev.id} href={`/events/${ev.id}`}
                  className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors group">
                  <span className="text-2xl shrink-0">{ev.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 group-hover:text-amber-600 transition-colors truncate">{ev.title}</p>
                    <p className="text-xs text-gray-400">{formatDate(ev.date)} · {ev.neighborhood}</p>
                  </div>
                  <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Block / Report — always visible at the bottom for other members */}
        {!isOwnProfile && (
          <div className="flex items-center justify-center gap-6 py-2 pb-4">
            <button
              onClick={() => setReporting(true)}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
              </svg>
              Report
            </button>
            <span className="w-px h-3 bg-gray-200" />
            <button
              onClick={blocked ? handleUnblock : handleBlock}
              disabled={blocking}
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors disabled:opacity-50">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              {blocked ? `Unblock ${member.name.split(' ')[0]}` : `Block ${member.name.split(' ')[0]}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
