'use client'

import { useState, useEffect, useCallback, useMemo, useRef, memo, Suspense } from 'react'
import posthog from 'posthog-js'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import Link from 'next/link'
import { resolveImageUrl, avatarUrl, getInitials, firstNameOf} from '@/lib/data'
import { countryFlag } from '@/lib/countries'
import { useAuth } from '@/contexts/AuthContext'
import ReportButton from '@/components/ReportButton'
import AdBannerStrip from '@/components/AdBannerStrip'
import MemberDiscovery from './MemberDiscovery'
import EmptyState from '@/components/EmptyState'
import MembershipBadge from '@/components/MembershipBadge'
import { SkeletonCard } from '@/components/Skeleton'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { cityBadge } from '@/lib/cityBadge'
import { LOOKING_FOR_OPTIONS } from '@/lib/profileOptions'

interface ConnectionUser {
  id: string; name: string; color: string
  profilePhoto: string | null; neighborhood: string | null
}

interface ConnectionRecord {
  id:          string
  requesterId: string
  receiverId:  string
  status:      string
  requester?:  ConnectionUser
  receiver?:   ConnectionUser
}

interface MemberClub {
  id: string
  name: string
  emoji: string
  slug: string
  isHost: boolean
}

const LOOKING_FOR_LABELS: Record<string, string> =
  Object.fromEntries(LOOKING_FOR_OPTIONS.map(o => [o.id, o.label]))

const SOCIAL_STYLE_MAP: Record<string, string> = {
  deep_talker:      '🗣️ Deep Talker',
  social_butterfly: '🎉 Social Butterfly',
  connector:        '🤝 Connector',
  initiator:        '🔥 Initiator',
  laid_back:        '🧘 Laid-back',
  new_in_town:      '🌱 New in Town',
  small_groups:     '☕ Small Groups',
  up_for_anything:  '🎭 Up for Anything',
}

interface HangoutSummary {
  id:           string
  title:        string
  location:     string
  neighborhood: string | null
  startsAt:     string
  endsAt:       string
  user: { id: string; name: string; color: string; profilePhoto: string | null }
}

interface Member {
  id: string
  name: string
  color: string
  bio: string | null
  neighborhood: string | null
  nationality: string | null
  interests: string[]
  languages: string[]
  socialStyles: string[]
  lookingFor?: string[]
  profilePhoto: string | null
  joinedAt: string
  role: string
  isHost: boolean
  clubs: MemberClub[]
  eventsCount: number
  eventIds?: string[]
  instagram: string | null
  linkedin: string | null
  lastActive: string | null
  openToCoffee?:   boolean
  openToLanguage?: boolean
  openToHosting?:  boolean
  // True when this is a 'connections only' member the viewer isn't
  // connected to — the card shows identity + neighborhood only, and the
  // full profile is gated until they connect.
  restricted?: boolean
  membershipType?: string | null
  foundingMember?: boolean
  // True while the member has a live availability pulse — drives the
  // "🟢 free now" card badge and the "Around now" filter.
  activePulse?: boolean
}

function displayRole(m: Member): { label: string; cls: string } {
  if (m.role === 'admin')     return { label: 'Admin', cls: 'bg-amber-100 text-amber-700' }
  if (m.role === 'moderator') return { label: 'Mod',   cls: 'bg-purple-100 text-purple-700' }
  return { label: 'Member', cls: 'bg-gray-100 text-gray-600' }
}

function Avatar({ m, size = 'md' }: { m: Member; size?: 'md' | 'lg' }) {
  // #7 perf: ask the file route for a 256-wide variant for the
  // large card (96px CSS = retina 192px) and a 128-wide for the
  // medium card (56px CSS). Originals are 1200×1200 quality-82
  // JPEGs (~150–300 KB); the thumbnails land at ~3–10 KB.
  // Members directory loads dozens of these per scroll, so the
  // wire-bytes saving is what makes the page snappy on cellular.
  const photoLg = avatarUrl(m.profilePhoto, 256)
  const photoMd = avatarUrl(m.profilePhoto, 128)
  if (size === 'lg') {
    return photoLg ? (
      <img src={photoLg} alt={m.name} loading="lazy" decoding="async" className="w-24 h-24 rounded-full object-cover shrink-0 border-4 border-white shadow-md" />
    ) : (
      <div className="w-24 h-24 rounded-full flex items-center justify-center text-white font-bold text-2xl shrink-0 border-4 border-white shadow-md" style={{ backgroundColor: m.color }}>
        {getInitials(m.name)}
      </div>
    )
  }
  return photoMd ? (
    <img src={photoMd} alt={m.name} loading="lazy" decoding="async" className="w-14 h-14 rounded-full object-cover shrink-0" />
  ) : (
    <div className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0" style={{ backgroundColor: m.color }}>
      {getInitials(m.name)}
    </div>
  )
}

function ConnectButton({ m, currentUserId, connections, onConnectionChange }: {
  m: Member
  currentUserId: string
  connections: ConnectionRecord[]
  onConnectionChange: (updated: ConnectionRecord | null, removed?: string) => void
}) {
  const [loading,  setLoading]  = useState(false)
  const [showNote, setShowNote] = useState(false)
  const [note,     setNote]     = useState('')

  const conn = connections.find(c =>
    (c.requesterId === currentUserId && c.receiverId === m.id) ||
    (c.receiverId === currentUserId && c.requesterId === m.id)
  )

  const iRequested = conn?.requesterId === currentUserId
  const theyRequested = conn?.requesterId === m.id && conn?.receiverId === currentUserId

  async function sendRequest() {
    setLoading(true)
    try {
      const res = await fetch('/app/api/connections', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiverId: m.id, note: note.trim() || undefined }),
      })
      if (!res.ok) {
        toast.error(`Could not send request to ${firstNameOf(m.name)}`)
        return
      }
      const data = await res.json()
      onConnectionChange(data.connection)
      toast.success(`Request sent to ${firstNameOf(m.name)}`)
      setShowNote(false)
      setNote('')
    } catch {
      toast.error('Network error — check your connection')
    } finally { setLoading(false) }
  }

  async function accept() {
    if (!conn) return
    setLoading(true)
    try {
      const res = await fetch(`/app/api/connections/${conn.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept' }),
      })
      if (!res.ok) {
        toast.error('Could not accept request')
        return
      }
      const data = await res.json()
      onConnectionChange(data.connection)
      toast.success(`Connected with ${firstNameOf(m.name)}`)
    } catch {
      toast.error('Network error — check your connection')
    } finally { setLoading(false) }
  }

  async function remove() {
    if (!conn) return
    setLoading(true)
    try {
      const res = await fetch(`/app/api/connections/${conn.id}`, {
        method: 'DELETE', credentials: 'include',
      })
      if (!res.ok) {
        // Different copy depending on what state we're cancelling.
        const what = conn.status === 'pending'
          ? (iRequested ? 'cancel request' : 'decline request')
          : 'disconnect'
        toast.error(`Could not ${what}`)
        return
      }
      onConnectionChange(null, conn.id)
    } catch {
      toast.error('Network error — check your connection')
    } finally { setLoading(false) }
  }

  if (!conn) {
    if (showNote) {
      return (
        <div className="flex flex-col gap-2 w-full max-w-xs">
          <textarea
            value={note} onChange={e => setNote(e.target.value)}
            placeholder={`How do you know ${firstNameOf(m.name)}? (optional)`}
            rows={2} maxLength={200} autoFocus
            className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <div className="flex gap-2">
            <button onClick={sendRequest} disabled={loading}
              className="flex-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60">
              {loading ? '...' : 'Send'}
            </button>
            <button onClick={() => setShowNote(false)}
              className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )
    }
    return (
      <button onClick={() => setShowNote(true)} disabled={loading}
        className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60">
        + Connect
      </button>
    )
  }

  if (theyRequested && conn.status === 'pending') {
    return (
      <div className="flex items-center gap-2">
        <button onClick={accept} disabled={loading}
          className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60">
          ✓ Accept
        </button>
        <button onClick={remove} disabled={loading}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold rounded-xl transition-colors disabled:opacity-60">
          Decline
        </button>
      </div>
    )
  }

  if (conn.status === 'pending' && iRequested) {
    return (
      <button onClick={remove} disabled={loading}
        className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-semibold rounded-xl border border-gray-200 transition-colors disabled:opacity-60">
        {loading ? '...' : 'Pending…'}
      </button>
    )
  }

  // accepted — just a small disconnect link, badge in name row is the visual indicator
  return (
    <button onClick={remove} disabled={loading}
      className="text-xs text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
      title="Remove connection">
      {loading ? '…' : 'Disconnect'}
    </button>
  )
}

function MemberModal({ m, onClose, currentUserId, currentUserRole, viewerPrivileged, myClubIds, myEventIds, members, connections, onConnectionChange }: {
  m: Member; onClose: () => void; currentUserId: string; currentUserRole: string
  viewerPrivileged: boolean
  myClubIds: string[]; myEventIds: string[]; members: Member[]
  connections: ConnectionRecord[]
  onConnectionChange: (updated: ConnectionRecord | null, removed?: string) => void
}) {
  const flag        = countryFlag(m.nationality)
  const photo       = resolveImageUrl(m.profilePhoto)
  const role        = displayRole(m)
  const commonClubs = m.clubs.filter(c => myClubIds.includes(c.id))
  const commonEvents = myEventIds.filter(id => (m.eventIds ?? []).includes(id)).length

  // Admins, moderators, and club hosts see full profiles regardless of
  // connection. currentUserRole still drives nothing else here.
  const isPrivileged = viewerPrivileged || currentUserRole === 'admin' || currentUserRole === 'moderator'

  const conn = connections.find(c =>
    (c.requesterId === currentUserId && c.receiverId === m.id) ||
    (c.receiverId === currentUserId && c.requesterId === m.id)
  )
  const isConnected = isPrivileged || conn?.status === 'accepted'

  const [blocked,    setBlocked]    = useState(false)
  const [blocking,   setBlocking]   = useState(false)
  // Two-state block confirmation. Was native confirm() — unstyled,
  // non-accessible, can't be branded. Now: first click flips
  // confirmingBlock true → inline 'Yes, block' / 'Cancel' surface
  // takes over; second click commits.
  const [confirmingBlock, setConfirmingBlock] = useState(false)

  async function commitBlock() {
    setBlocking(true)
    try {
      const res = await fetch('/app/api/members/block', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: m.id }),
      })
      if (!res.ok) {
        toast.error(`Could not block ${firstNameOf(m.name)}`)
        return
      }
      setBlocked(true)
      toast.success(`Blocked ${firstNameOf(m.name)}`)
      onClose()
    } catch {
      toast.error('Network error — check your connection')
    } finally {
      setBlocking(false)
      setConfirmingBlock(false)
    }
  }

  async function handleUnblock() {
    setBlocking(true)
    try {
      const res = await fetch('/app/api/members/block', {
        method: 'DELETE', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: m.id }),
      })
      if (!res.ok) {
        toast.error('Could not unblock')
        return
      }
      setBlocked(false)
      toast.success('Unblocked')
    } catch {
      toast.error('Network error — check your connection')
    } finally { setBlocking(false) }
  }

  // Modal panel ref + focus management: move focus into the modal on
  // open (so SR/keyboard users land inside), restore to the trigger on
  // unmount, and trap Tab cycling within the panel so focus can't leak
  // back to the page content behind. Escape-to-close is the same effect
  // it always was.
  const panelRef   = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null
    // Focus the first focusable element inside the panel (the close
    // button is the topmost). RAF defers until layout settles so the
    // panel is actually mounted.
    requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    })
    return () => { triggerRef.current?.focus() }
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last  = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Shared block control — rendered in both the connected-profile footer
  // and the not-connected footer below. Two-state: starts as the plain
  // 'Block X' button, flips to an inline 'Block X? · Yes · Cancel' row on
  // first click, commits on the second.
  const blockButton = confirmingBlock ? (
    <div className="flex items-center gap-2">
      <span className="text-xs text-red-700 font-semibold">Block {firstNameOf(m.name)}?</span>
      <button onClick={commitBlock} disabled={blocking}
        className="text-xs px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold disabled:opacity-50">
        {blocking ? '…' : 'Yes, block'}
      </button>
      <button onClick={() => setConfirmingBlock(false)} disabled={blocking}
        className="text-xs px-2 py-1 hover:bg-gray-100 text-gray-600 rounded-lg font-medium disabled:opacity-50">
        Cancel
      </button>
    </div>
  ) : (
    <button onClick={blocked ? handleUnblock : () => setConfirmingBlock(true)} disabled={blocking}
      className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-600 transition-colors disabled:opacity-50">
      <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
      {blocked ? 'Unblock' : `Block ${firstNameOf(m.name)}`}
    </button>
  )

  const roleBadge = m.isHost
    ? <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-500 text-white">Host</span>
    : <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${role.cls}`}>{role.label}</span>

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${m.name} profile`}
        className="relative bg-white w-full md:max-w-md rounded-t-3xl md:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button onClick={onClose} aria-label="Close profile" className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors">
          <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Content — scrollable. Layout mirrors the standalone /members/[id]
            page: photo thumbnail beside the identity, full-width action row,
            then captioned About / Interests sections — instead of the old
            full-bleed cover photo with details scattered below it. */}
        <div className="flex-1 overflow-y-auto">
          {/* Identity header — always visible */}
          <div className="px-4 pt-5 pb-1">
            <div className="flex items-start gap-4">
              <div className="relative shrink-0">
                {photo ? (
                  <img src={photo} alt={m.name} className="w-24 h-24 rounded-2xl object-cover" style={{ objectPosition: '50% 20%' }} />
                ) : (
                  <div className="w-24 h-24 rounded-2xl flex items-center justify-center text-3xl font-bold text-white" style={{ backgroundColor: m.color }}>
                    {getInitials(m.name)}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 pt-1 pr-7">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-extrabold text-gray-900 leading-tight">
                    {isConnected || m.id === currentUserId ? m.name : firstNameOf(m.name)}
                    {(isConnected || m.id === currentUserId) && flag && <span className="ml-1.5 text-base font-normal">{flag}</span>}
                  </h2>
                  <MembershipBadge membershipType={m.membershipType} className="shrink-0 text-[10px] px-2 py-0.5" />
                  {m.foundingMember && (
                    <span className="shrink-0 text-[10px] font-semibold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">⭐ Founding</span>
                  )}
                  {/* Role badge only when it carries information — plain
                      'Member' is the default and just eats space. */}
                  {(m.isHost || m.role === 'admin' || m.role === 'moderator') && roleBadge}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  {(isConnected || m.id === currentUserId) && m.neighborhood ? <>📍 {m.neighborhood} · </> : null}
                  Joined {new Date(m.joinedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                </p>
                {conn?.status === 'accepted' && (
                  <span className="inline-flex items-center gap-0.5 mt-1.5 text-xs font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    Connected
                  </span>
                )}
              </div>
            </div>

            {/* Action row — full-width buttons like the profile page. Once
                connected, Message leads and disconnect shrinks to a text
                link so the destructive action never dominates. */}
            {m.id !== currentUserId && (
              <div className="flex items-center gap-3 mt-4">
                {conn?.status === 'accepted' ? (
                  <>
                    <Link href={`/messages/${m.id}`} onClick={onClose}
                      className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      Message
                    </Link>
                    <ConnectButton m={m} currentUserId={currentUserId} connections={connections} onConnectionChange={onConnectionChange} />
                  </>
                ) : (
                  <>
                    <div className="flex-1 [&>button]:w-full [&>button]:justify-center">
                      <ConnectButton m={m} currentUserId={currentUserId} connections={connections} onConnectionChange={onConnectionChange} />
                    </div>
                    {isPrivileged && (
                      <Link href={`/messages/${m.id}`} onClick={onClose}
                        className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        Message
                      </Link>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Locked state — not connected. Restricted (the member chose
              'connections only') gets privacy-specific copy; everyone else
              gets the general "connect to see more" gating. */}
          {!isConnected && m.id !== currentUserId && (
            <div className="px-4 pb-5 pt-3 flex flex-col items-center text-center gap-2">
              <div className="text-3xl">🔒</div>
              {m.restricted ? (
                <>
                  <p className="text-sm font-semibold text-gray-700">This profile is private</p>
                  <p className="text-xs text-gray-400">{firstNameOf(m.name)} keeps their profile to connections only. Send a request — once they accept, you’ll see their full profile.</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-gray-700">Connect to see more</p>
                  <p className="text-xs text-gray-400">Bio, interests, clubs, and social links are only visible to connected members.</p>
                </>
              )}
            </div>
          )}

          {/* Full profile — connected or own profile */}
          {(isConnected || m.id === currentUserId) && (
            <>
              {/* Stats row — flag/neighborhood/joined moved into the header,
                  so this is just the activity numbers now */}
              <div className="flex divide-x divide-gray-100 border-y border-gray-100 mx-4 my-3">
                <div className="flex-1 py-2 text-center">
                  <p className="text-sm font-extrabold text-gray-900">🎟 {m.eventsCount}</p>
                  <p className="text-xs text-gray-400">{commonEvents > 0 ? `${commonEvents} shared` : 'Events'}</p>
                </div>
                <div className="flex-1 py-2 text-center">
                  <p className="text-sm font-extrabold text-gray-900">🏛 {m.clubs.length}</p>
                  <p className="text-xs text-gray-400">Clubs</p>
                </div>
              </div>

              <div className="px-4 pb-4 space-y-3">
                {m.bio && (
                  <p className="text-sm text-gray-600 leading-relaxed">{m.bio}</p>
                )}

                {m.socialStyles?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.socialStyles.map(s => (
                      <span key={s} className="px-2.5 py-1 bg-violet-50 text-violet-700 border border-violet-100 rounded-full text-xs font-medium">
                        {SOCIAL_STYLE_MAP[s] ?? s}
                      </span>
                    ))}
                  </div>
                )}

                {(m.lookingFor?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.lookingFor!.map(lf => (
                      <span key={lf} className="px-2.5 py-1 bg-sky-50 text-sky-700 border border-sky-100 rounded-full text-xs font-medium">
                        🔎 {LOOKING_FOR_LABELS[lf] ?? lf}
                      </span>
                    ))}
                  </div>
                )}

                {m.instagram && (
                  <a
                    href={`https://instagram.com/${m.instagram.replace('@', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 bg-gradient-to-r from-pink-50 to-purple-50 border border-pink-100 rounded-xl text-sm font-semibold text-pink-600 hover:from-pink-100 hover:to-purple-100 transition-colors"
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                    </svg>
                    {m.instagram.startsWith('@') ? m.instagram : `@${m.instagram}`}
                  </a>
                )}

                {m.linkedin && (
                  <a
                    href={`https://linkedin.com/in/${m.linkedin.replace(/.*linkedin\.com\/in\//i, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-4 py-2.5 bg-blue-50 border border-blue-100 rounded-xl text-sm font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.761 0 5-2.239 5-5v-14c0-2.761-2.239-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                    </svg>
                    LinkedIn
                  </a>
                )}

                {m.languages.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.languages.map(l => (
                      <span key={l} className="px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-100 rounded-full text-xs font-medium">🗣 {l}</span>
                    ))}
                  </div>
                )}

                {m.interests.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.interests.map(i => (
                      <span key={i} className="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-full text-xs font-medium">{i}</span>
                    ))}
                  </div>
                )}

                {m.clubs.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {m.clubs.map(c => {
                      const shared = myClubIds.includes(c.id)
                      return (
                        <Link key={c.id} href={`/clubs/${c.slug}`} onClick={onClose}
                          className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-xl text-xs font-medium transition-colors ${
                            shared
                              ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                              : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-700'
                          }`}>
                          <span>{c.emoji}</span>
                          <span>{c.name}</span>
                          {c.isHost && <span className="text-[9px] font-bold text-amber-500">HOST</span>}
                          {shared && <span className="text-[9px] font-bold text-amber-500">SHARED</span>}
                        </Link>
                      )
                    })}
                  </div>
                )}

                {m.id !== currentUserId && (
                  <div className="pt-2 border-t border-gray-100 flex items-center gap-4">
                    <ReportButton reportedId={m.id} reportedName={m.name} />
                    <span className="w-px h-3 bg-gray-200 shrink-0" />
                    {blockButton}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Report + Block — accessible when not connected */}
          {!isConnected && m.id !== currentUserId && (
            <div className="px-4 pb-4 border-t border-gray-100 pt-3 flex items-center gap-4">
              <ReportButton reportedId={m.id} reportedName={m.name} />
              <span className="w-px h-3 bg-gray-200 shrink-0" />
              {blockButton}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const MemberCard = memo(function MemberCard({ m, onSelect, connectionStatus, hangingOut }: { m: Member; onSelect: (m: Member) => void; connectionStatus?: string; hangingOut?: boolean }) {
  const flag    = countryFlag(m.nationality)
  const photo   = avatarUrl(m.profilePhoto, 256)
  const isOnline = m.lastActive
    ? (Date.now() - new Date(m.lastActive).getTime()) < 20 * 60 * 1000
    : false
  const isConnected = connectionStatus === 'accepted' || connectionStatus === 'privileged'

  const displayName = isConnected ? m.name : firstNameOf(m.name)

  return (
    <button
      onClick={() => onSelect(m)}
      aria-label={`View ${displayName}'s profile`}
      className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden text-left hover:-translate-y-0.5 hover:shadow-md hover:border-gray-200 transition-all duration-200 w-full flex flex-col group"
    >
      {/* Portrait photo */}
      <div className="relative w-full aspect-[3/4] bg-gray-100">
        {photo ? (
          <img src={photo} alt={m.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" style={{ objectPosition: '50% 20%' }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl font-bold text-white" style={{ backgroundColor: m.color }}>
            {getInitials(m.name)}
          </div>
        )}

        <div className="absolute top-2 right-2 flex items-center gap-1">
          {hangingOut && (
            <span title="Has an active hangout — see /hangouts"
              className="flex items-center gap-1 bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              Hangout
            </span>
          )}
          {m.activePulse && (
            <span title="Free to meet up right now"
              className="flex items-center gap-1 bg-emerald-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              Free now
            </span>
          )}
          {connectionStatus === 'accepted' && (
            <span className="flex items-center gap-0.5 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
              <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </span>
          )}
          {connectionStatus === 'pending' && (
            <span className="bg-amber-100 text-amber-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">●</span>
          )}
          {m.restricted && (
            <span title="Private profile — connect to view"
              className="flex items-center gap-0.5 bg-gray-900/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm backdrop-blur-sm">
              🔒 Private
            </span>
          )}
        </div>

        {/* Bottom-left status cluster: online dot + Host badge, above the gradient */}
        {(isOnline || m.isHost) && (
          <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1.5">
            {isOnline && (
              <span className="flex items-center" title="Active recently">
                <span className="w-2 h-2 bg-green-400 border-2 border-white rounded-full shadow-sm" />
                <span className="sr-only">Active recently</span>
              </span>
            )}
            {m.isHost && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-500 text-white shadow-sm">Host</span>
            )}
          </div>
        )}

        {/* Bottom gradient overlay with flag */}
        <div className="absolute bottom-0 inset-x-0 h-12 bg-gradient-to-t from-black/40 to-transparent" />
        {flag && (
          <span className="absolute bottom-2 right-2 text-base drop-shadow-sm">{flag}</span>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div>
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="font-bold text-gray-900 text-sm leading-tight truncate">
              {displayName}
            </p>
            <MembershipBadge membershipType={m.membershipType} className="shrink-0 text-[10px] px-1.5 py-0.5" />
            {m.foundingMember && (
              <span className="shrink-0 text-[10px] font-semibold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">⭐ Founding</span>
            )}
          </div>
          {isConnected && m.neighborhood && (
            <p className="text-[11px] text-gray-400 truncate mt-0.5">📍 {m.neighborhood}</p>
          )}
          {m.restricted && (
            <p className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1">
              <span aria-hidden="true">🔒</span> Connect to view profile
            </p>
          )}
        </div>

        {m.socialStyles?.length > 0 && (
          <span className="self-start px-2 py-0.5 bg-violet-50 text-violet-600 border border-violet-100 rounded-full text-[11px] font-medium truncate max-w-full">
            {SOCIAL_STYLE_MAP[m.socialStyles[0]] ?? m.socialStyles[0]}
          </span>
        )}

        {/* "Open to…" availability pills — small, emoji-led so they read at a glance. */}
        {(m.openToCoffee || m.openToLanguage || m.openToHosting) && (
          <div className="flex flex-wrap gap-1">
            {m.openToCoffee   && <span title="Open to coffee with newcomers"  aria-label="Open to coffee with newcomers"  className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-100 rounded-full">☕</span>}
            {m.openToLanguage && <span title="Open to language exchange"      aria-label="Open to language exchange"      className="text-[10px] px-1.5 py-0.5 bg-blue-50  text-blue-700  border border-blue-100  rounded-full">🗣️</span>}
            {m.openToHosting  && <span title="Open to hosting visitors"       aria-label="Open to hosting visitors"       className="text-[10px] px-1.5 py-0.5 bg-green-50 text-green-700 border border-green-100 rounded-full">🏠</span>}
          </div>
        )}

        <div className="flex items-center gap-1.5 mt-auto pt-2 border-t border-gray-50 text-[11px] text-gray-400">
          {m.eventsCount > 0 && (
            <span className="flex items-center gap-0.5">
              <span>🎟</span> {m.eventsCount}
            </span>
          )}
          {m.eventsCount > 0 && m.clubs.length > 0 && <span className="text-gray-200">·</span>}
          {m.clubs.length > 0 && (
            <span className="flex items-center gap-0.5">
              <span>🏛</span> {m.clubs.length}
            </span>
          )}
          <span className="ml-auto text-[10px] text-gray-300">
            {new Date(m.joinedAt).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}
          </span>
        </div>
      </div>
    </button>
  )
})

// Mobile flash-card deck — browse members one at a time, swiping (or tapping
// the arrows) through the same filtered/sorted list as the grid. Privacy
// mirrors MemberCard/MemberModal: first-name-only, bio/neighborhood/interests
// gated behind a connection. Deliberately NO swipe-left/right verdict
// mechanic — it's a browse mode, not a rating game (no addictive loops).
function MemberFlashCards({ members, currentUserId, connections, onConnectionChange, onSelect, getConnectionStatus, onNearEnd }: {
  members: Member[]
  currentUserId: string
  connections: ConnectionRecord[]
  onConnectionChange: (updated: ConnectionRecord | null, removed?: string) => void
  onSelect: (m: Member) => void
  getConnectionStatus: (id: string) => string | undefined
  onNearEnd?: () => void
}) {
  const [index, setIndex] = useState(0)
  const [dx, setDx] = useState(0)
  const touchX = useRef<number | null>(null)

  // Filters can shrink the list under the cursor — clamp, don't crash.
  const i = members.length ? Math.min(index, members.length - 1) : 0
  const m: Member | undefined = members[i]

  useEffect(() => {
    if (onNearEnd && members.length > 0 && members.length - i <= 5) onNearEnd()
  }, [i, members.length, onNearEnd])

  if (!m) return null

  const status      = getConnectionStatus(m.id)
  const isConnected = status === 'accepted' || status === 'privileged'
  const isSelf      = m.id === currentUserId
  const flag        = countryFlag(m.nationality)
  const photo       = resolveImageUrl(m.profilePhoto)
  const displayName = isConnected || isSelf ? m.name : firstNameOf(m.name)

  const go = (dir: 1 | -1) => {
    setDx(0)
    setIndex(Math.min(Math.max(i + dir, 0), members.length - 1))
  }

  return (
    <div className="max-w-sm mx-auto select-none">
      <div
        className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden"
        style={{ transform: `translateX(${dx}px) rotate(${dx / 40}deg)`, transition: dx === 0 ? 'transform 0.2s' : 'none' }}
        onTouchStart={e => { touchX.current = e.touches[0].clientX }}
        onTouchMove={e => { if (touchX.current !== null) setDx(e.touches[0].clientX - touchX.current) }}
        onTouchEnd={() => {
          const d = dx
          touchX.current = null
          if (d < -60) go(1)
          else if (d > 60) go(-1)
          else setDx(0)
        }}
      >
        <button onClick={() => onSelect(m)} className="block w-full text-left" aria-label={`View ${displayName}'s profile`}>
          <div className="relative w-full aspect-[4/5] bg-gray-100">
            {photo ? (
              <img src={photo} alt={displayName} className="w-full h-full object-cover" style={{ objectPosition: '50% 20%' }} draggable={false} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-6xl font-bold text-white" style={{ backgroundColor: m.color }}>
                {getInitials(m.name)}
              </div>
            )}
            <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-3 left-4 right-4">
              <p className="text-white text-2xl font-extrabold drop-shadow-sm truncate">
                {displayName} {flag && <span className="text-xl">{flag}</span>}
              </p>
              <p className="text-white/80 text-xs mt-0.5">
                {isConnected && m.neighborhood ? `📍 ${m.neighborhood} · ` : ''}
                Joined {new Date(m.joinedAt).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
              </p>
            </div>
            {m.isHost && <span className="absolute top-3 left-3 text-[10px] font-bold px-2 py-1 rounded-full bg-blue-500 text-white shadow-sm">Host</span>}
            {m.restricted && (
              <span className="absolute top-3 right-3 flex items-center gap-0.5 bg-gray-900/70 text-white text-[10px] font-bold px-2 py-1 rounded-full backdrop-blur-sm">🔒 Private</span>
            )}
          </div>
        </button>

        <div className="p-4 space-y-3">
          {isConnected && m.bio ? (
            <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">{m.bio}</p>
          ) : !isConnected && !isSelf ? (
            <p className="text-xs text-gray-400">
              🔒 {m.restricted ? `${displayName} keeps their profile to connections only.` : 'Bio and interests unlock when you connect.'}
            </p>
          ) : null}

          {isConnected && m.interests.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {m.interests.slice(0, 5).map(int => (
                <span key={int} className="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-100 rounded-full text-xs font-medium">{int}</span>
              ))}
              {m.interests.length > 5 && <span className="text-xs text-gray-300 self-center">+{m.interests.length - 5}</span>}
            </div>
          )}

          {!isSelf && (
            <div className="flex items-center gap-2">
              <ConnectButton m={m} currentUserId={currentUserId} connections={connections} onConnectionChange={onConnectionChange} />
              {isConnected && (
                <Link href={`/messages/${m.id}`} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors">
                  💬 Message
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 px-2">
        <button onClick={() => go(-1)} disabled={i === 0} aria-label="Previous member"
          className="w-11 h-11 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-600 disabled:opacity-30">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <p className="text-xs text-gray-400 font-medium">{i + 1} / {members.length}</p>
        <button onClick={() => go(1)} disabled={i === members.length - 1} aria-label="Next member"
          className="w-11 h-11 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-600 disabled:opacity-30">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
    </div>
  )
}

type RoleFilter = 'All' | 'Hosts' | 'Admins' | 'Saved'
type SortOption = 'newest' | 'active' | 'az'

const ROLE_FILTERS: RoleFilter[] = ['All', 'Hosts', 'Admins', 'Saved']

export default function MembersPage() {
  return <Suspense><MembersPageInner /></Suspense>
}

function MembersPageInner() {
  const searchParams   = useSearchParams()
  const neighborhoodParam = searchParams.get('neighborhood') ?? ''
  const { user } = useAuth()
  const [members,      setMembers]      = useState<Member[]>([])
  const [filteredMembers, setFilteredMembers] = useState<Member[] | null>(null)
  const [total,        setTotal]        = useState(0)
  const [hostTotal,    setHostTotal]    = useState(0)
  const [adminTotal,   setAdminTotal]   = useState(0)
  const [savedTotal,   setSavedTotal]   = useState(0)
  const [hasMore,      setHasMore]      = useState(false)
  const [loadingMore,  setLoadingMore]  = useState(false)
  const [loading,      setLoading]      = useState(true)
  const [filterLoading, setFilterLoading] = useState(false)
  const [search,       setSearch]       = useState(neighborhoodParam)
  const [roleFilter,   setRoleFilter]   = useState<RoleFilter>('All')
  // ?openTo= filter — only one active at a time (matches the role-pill UX).
  const [openToFilter, setOpenToFilter] = useState<'' | 'coffee' | 'language' | 'hosting'>('')
  // "Around now" — only members with a live availability pulse.
  const [aroundNow,    setAroundNow]    = useState(false)
  const [speaksMyLang, setSpeaksMyLang] = useState(false)
  const [lookingForFilter, setLookingForFilter] = useState('')
  const [sort,         setSort]         = useState<SortOption>('newest')
  // Mobile-only view mode: the classic grid or the one-at-a-time flash-card
  // deck. Desktop always renders the grid regardless of this state.
  const [view,         setView]         = useState<'grid' | 'cards'>('grid')
  const [selected,     setSelected]     = useState<Member | null>(null)
  const [myClubIds,    setMyClubIds]    = useState<string[]>([])
  const [myEventIds,   setMyEventIds]   = useState<string[]>([])
  const [connections,  setConnections]  = useState<ConnectionRecord[]>([])
  // Active hangouts — drives the strip at the top and the "Hanging out" badge
  // on member cards, bridging /members and /hangouts so the live signal isn't
  // siloed in a separate page.
  const [hangouts, setHangouts] = useState<HangoutSummary[]>([])
  // CMS overrides land via /api/content. Default headline was a one-
  // word 'Members' file-cabinet label; 'Find your people' echoes the
  // landing-page line and reads as an invitation.
  const city = useCurrentCity()
  const [hero, setHero] = useState({ badge: 'Members', headline: 'Meet the community.', subtitle: 'Discover people through the neighborhoods, interests and experiences you share.' })

  const handleConnectionChange = useCallback((updated: ConnectionRecord | null, removed?: string) => {
    if (removed) {
      setConnections(prev => prev.filter(c => c.id !== removed))
    } else if (updated) {
      setConnections(prev => {
        const idx = prev.findIndex(c => c.id === updated.id)
        if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next }
        return [...prev, updated]
      })
    }
  }, [])

  // Pending Accept/Decline helper — was two inline arrow functions per
  // request with no res.ok check and no toast on failure (silent failure
  // pattern we just fixed on clubs). Single helper handles both actions
  // with try/catch/finally + toast feedback.
  const handlePendingAction = useCallback(async (reqId: string, action: 'accept' | 'decline', firstName: string) => {
    try {
      const res = await fetch(`/app/api/connections/${reqId}`, {
        method:  'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
      })
      if (!res.ok) {
        toast.error(action === 'accept' ? 'Could not accept request' : 'Could not decline request')
        return
      }
      if (action === 'accept') {
        const data = await res.json()
        handleConnectionChange(data.connection)
        toast.success(`Connected with ${firstName}`)
      } else {
        handleConnectionChange(null, reqId)
      }
    } catch {
      toast.error('Network error — check your connection')
    }
  }, [handleConnectionChange])

  // One-shot mount fetches: hero CMS content + members + clubs + events
  // + connections + hangouts. Was a separate useEffect for the hero
  // fetch — moving it into the same Promise.all lets React commit all
  // setStates in one render instead of two. Each fetch fails open with
  // `null` so a flaky CMS endpoint doesn't take down the grid.
  useEffect(() => {
    Promise.all([
      fetch('/app/api/content',                                       ).then(r => r.json()).catch(() => null),
      fetch('/app/api/members?offset=0',  { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/app/api/clubs/memberships', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/app/api/events/attending',  { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/app/api/connections',       { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/app/api/hangouts',          { credentials: 'include' }).then(r => r.json()).catch(() => null),
    ]).then(([content, membersData, clubsData, eventsData, connData, hangoutsData]) => {
      if (content?.members) setHero(h => ({ ...h, ...content.members }))
      setMembers(Array.isArray(membersData?.members) ? membersData.members : [])
      setTotal(membersData?.total ?? 0)
      setHostTotal(membersData?.hostTotal ?? 0)
      setAdminTotal(membersData?.adminTotal ?? 0)
      setSavedTotal(membersData?.savedTotal ?? 0)
      setHasMore(membersData?.hasMore ?? false)
      setMyClubIds(Array.isArray(clubsData) ? clubsData.map((c: any) => c.clubId ?? c.id) : [])
      setMyEventIds(Array.isArray(eventsData) ? eventsData.map((e: any) => e.eventId ?? e.id) : [])
      const sentList = Array.isArray(connData?.sent)     ? connData.sent     : []
      const rcvList  = Array.isArray(connData?.received) ? connData.received : []
      setConnections([...sentList, ...rcvList])
      setHangouts(Array.isArray(hangoutsData?.hangouts) ? hangoutsData.hangouts : [])
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const trimmed = search.trim()
    // No active filters at all → fall back to the initial member list.
    if (roleFilter === 'All' && !openToFilter && !aroundNow && !speaksMyLang && !lookingForFilter && !trimmed) { setFilteredMembers(null); return }

    // Debounce search input so typing "yasemin" fires one fetch, not seven.
    // role/openTo changes don't need debouncing (single click) but routing
    // through the same timer keeps the effect simple.
    const delay = trimmed ? 250 : 0
    // Abort the in-flight fetch on filter change/clear — without it, a slow
    // filtered response could land after "clear all" reset filteredMembers
    // to null and re-apply the stale filtered list over the full one.
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      // §55 — search/filter usage. Debounced with the fetch so we log
      // intents, not keystrokes.
      if (trimmed) posthog.capture('member_search', { length: trimmed.length })
      if (roleFilter !== 'All' || openToFilter || aroundNow || speaksMyLang || lookingForFilter) {
        posthog.capture('member_filter_used', { role: roleFilter, openTo: openToFilter || null, aroundNow, speaksMyLang, lookingFor: lookingForFilter || null })
      }
      setFilterLoading(true)
      const params = new URLSearchParams()
      if (roleFilter === 'Hosts')  params.set('isHost', 'true')
      if (roleFilter === 'Admins') params.set('adminOnly', 'true')
      if (roleFilter === 'Saved')  params.set('savedOnly', 'true')
      if (openToFilter)            params.set('openTo', openToFilter)
      if (aroundNow)               params.set('aroundNow', 'true')
      if (speaksMyLang)            params.set('speaksMyLang', 'true')
      if (lookingForFilter)        params.set('lookingFor', lookingForFilter)
      if (trimmed)                 params.set('search', trimmed)
      fetch(`/app/api/members?${params}`, { credentials: 'include', signal: ctrl.signal })
        .then(r => r.json())
        .then(d => setFilteredMembers(Array.isArray(d?.members) ? d.members : []))
        .catch((e: unknown) => {
          if ((e as Error)?.name !== 'AbortError') setFilteredMembers([])
        })
        .finally(() => setFilterLoading(false))
    }, delay)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [roleFilter, openToFilter, aroundNow, speaksMyLang, lookingForFilter, search])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const data = await fetch(`/app/api/members?offset=${members.length}`, { credentials: 'include' }).then(r => r.json())
      if (data?.members) {
        setMembers(prev => [...prev, ...data.members])
        setHasMore(data.hasMore)
      }
    } catch {
      // A network blip used to throw past setLoadingMore and freeze the
      // button in its loading state until a full reload.
      toast.error('Could not load more members')
    } finally {
      setLoadingMore(false)
    }
  }

  const activeMembers  = filteredMembers ?? members
  const hangoutHostIds = useMemo(() => new Set(hangouts.map(h => h.user.id)), [hangouts])

  const visible = useMemo(() => {
    const q = search.toLowerCase()
    // Relevance tier when a search is active: name matches on top, then
    // interests/clubs/nationality, then neighborhood-only. Without this,
    // searching "Levent" (a common Turkish name AND an Istanbul district)
    // buried the actual Levents under everyone who lives in the
    // neighborhood.
    const nameHit = (m: typeof activeMembers[number]) => m.name.toLowerCase().includes(q)
    const otherHit = (m: typeof activeMembers[number]) =>
      m.nationality?.toLowerCase().includes(q) ||
      m.interests.some(i => i.toLowerCase().includes(q)) ||
      m.clubs.some(c => c.name.toLowerCase().includes(q))
    const relevance = (m: typeof activeMembers[number]) =>
      nameHit(m) ? 0 : otherHit(m) ? 1 : 2

    return activeMembers
      .filter(m => {
        if (!search) return true
        return (
          m.name.toLowerCase().includes(q) ||
          m.neighborhood?.toLowerCase().includes(q) ||
          m.nationality?.toLowerCase().includes(q) ||
          m.interests.some(i => i.toLowerCase().includes(q)) ||
          m.clubs.some(c => c.name.toLowerCase().includes(q))
        )
      })
      .sort((a, b) => {
        if (search) {
          const rel = relevance(a) - relevance(b)
          if (rel !== 0) return rel
        }
        if (sort === 'active')  return b.eventsCount - a.eventsCount
        if (sort === 'az')      return a.name.localeCompare(b.name)
        return new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime()
      })
  }, [activeMembers, search, sort])

  const pendingRequests = connections.filter(c => c.receiverId === user.id && c.status === 'pending')
  const connectedCount  = connections.filter(c => c.status === 'accepted').length

  // Admins, moderators, and club hosts get full directory + profile
  // access (moderation / event management) regardless of connection.
  const isPrivilegedUser = user.role === 'admin' || user.role === 'moderator' || !!user.isClubHost

  // O(1) connection status lookup — built once when connections or user changes,
  // not re-scanned on every card render.
  const connectionStatusMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of connections) {
      const otherId = c.requesterId === user.id ? c.receiverId : c.requesterId
      if (c.requesterId === user.id || c.receiverId === user.id) map.set(otherId, c.status)
    }
    return map
  }, [connections, user.id])

  const getConnectionStatus = useCallback((memberId: string): string | undefined => {
    const status = connectionStatusMap.get(memberId)
    if (status) return status
    if (isPrivilegedUser) return 'privileged'
    return undefined
  }, [connectionStatusMap, isPrivilegedUser])

  const handleSelectMember = useCallback((m: Member) => setSelected(m), [])

  // Deck auto-pagination: when the flash-card cursor nears the end of the
  // loaded list, fetch the next page. Same eligibility rules as the grid's
  // "Load more" button (no server-side paging under search/role filters).
  const handleDeckNearEnd = useCallback(() => {
    if (hasMore && !loadingMore && !search && roleFilter === 'All') loadMore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loadingMore, search, roleFilter, members.length])

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-0">
      {selected && <MemberModal m={selected} onClose={() => setSelected(null)} currentUserId={user.id} currentUserRole={user.role} viewerPrivileged={isPrivilegedUser} myClubIds={myClubIds} myEventIds={myEventIds} members={members} connections={connections} onConnectionChange={handleConnectionChange} />}

      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-0">
          <div className="flex flex-col sm:flex-row sm:items-start gap-4 mb-6">
            <div className="flex-1">
              {/* Members was the one main feed that never named its city:
                  events, clubs and directory all say which city they're
                  showing, while this said just "Members" over a city-scoped
                  list. Same shared rule, so it can't repeat the events page's
                  "ISTANBUL · ISTANBUL". */}
              <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">🤝 {cityBadge(hero.badge, city?.name)}</span>
              {/* And the way back. The view-city cookie lasts a year, so a
                  member who looked at another city needs a visible exit —
                  events, clubs and directory each have this; members didn't. */}
              {city?.viewing && city.homeName && (
                // eslint-disable-next-line @next/next/no-html-link-for-pages -- route handler that must run server-side to clear the cookie; <Link> would client-navigate past it
                <a href="/app/api/city/enter?clear=1&to=members"
                  className="inline-flex items-center gap-1.5 ml-2 mb-3 px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors">
                  ✕ Back to {city.homeName}
                </a>
              )}
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">{hero.headline}</h1>
              {/* Was 'X members · Y hosts · Z admins' — hosts/admins are
                  subsets of members so the · merge implied parallel
                  categories. The role-pill counts below already surface
                  the breakdowns where the user can act on them. */}
              <p className="text-base text-gray-600 mt-1 max-w-xl">{hero.subtitle}</p>
              {!loading && <p className="text-sm text-gray-400 mt-1">{total} members</p>}
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-72">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search name, interest, club…"
                  aria-label="Search members by name, interest, club, neighborhood, or nationality"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
              </div>
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortOption)}
                aria-label="Sort members"
                className="shrink-0 py-2.5 pl-3 pr-7 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white text-gray-700 appearance-none"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239ca3af'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '14px' }}
              >
                <option value="newest">Newest</option>
                <option value="active">Most active</option>
                <option value="az">A–Z</option>
              </select>
            </div>
          </div>

          <AdBannerStrip page="members" />

          {/* Active hangouts strip — bridges the gap between "Open to coffee"
              (settings opt-in) and actually showing up. Surfaces the live
              signal where members already browse. */}
          {hangouts.length > 0 && (
            <Link href="/hangouts" className="block mb-4 group">
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3 hover:from-amber-100 hover:to-orange-100 transition-colors">
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                  <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">Live</span>
                </div>
                <p className="text-sm text-amber-900 flex-1 truncate">
                  <strong>{hangouts.length}</strong> hangout{hangouts.length !== 1 ? 's' : ''} happening now
                  {hangouts[0]?.neighborhood && (
                    <span className="text-amber-700 font-normal"> · starting in {hangouts[0].neighborhood}</span>
                  )}
                </p>
                <span className="text-xs font-bold text-amber-600 shrink-0 group-hover:translate-x-0.5 transition-transform">See all →</span>
              </div>
            </Link>
          )}

          {/* Role + open-to filter pills. The role pills swap the whole
              grid view (only one active at a time), so they get proper
              role=tablist / role=tab / aria-selected. The open-to pills
              are toggle filters and stay plain buttons. `display:contents`
              on the tablist lets the inner role pills keep flowing in the
              parent flex wrap. */}
          <div className="flex flex-wrap gap-2 pb-4">
            <div role="tablist" aria-label="Filter members by role" className="contents">
              {(['All', 'Hosts', 'Admins', 'Saved'] as RoleFilter[]).map(f => {
                const count = f === 'Hosts' ? hostTotal : f === 'Admins' ? adminTotal : f === 'Saved' ? savedTotal : total
                const isActive = roleFilter === f
                // All four role pills share the same active style now (was
                // gray-900 for All, violet-500 for Admins, amber-400 for
                // Saved, amber-500 for Hosts). The emoji prefix carries the
                // role differentiation; the chip itself stays in one palette.
                return (
                  <button
                    key={f}
                    onClick={() => setRoleFilter(f)}
                    role="tab"
                    aria-selected={isActive}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-all ${
                      isActive
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}>
                    {f === 'Hosts' && '🔥 '}{f === 'Admins' && '⚡ '}{f === 'Saved' && '🔖 '}{f}
                    {!loading && count > 0 && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20' : 'bg-gray-100 text-gray-400'}`}>
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Divider — open-to filters are an orthogonal dimension to role */}
            <div className="w-px bg-gray-200 my-1.5 shrink-0" />

            {/* "Around now" — members with a live availability pulse. Green +
                live-dot so it reads as the time-sensitive filter it is. */}
            <button
              onClick={() => setAroundNow(v => !v)}
              aria-pressed={aroundNow}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-all ${
                aroundNow
                  ? 'bg-green-50 text-green-700 border-green-300'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-green-200'
              }`}
              title="Members who are free to meet up right now"
            >
              <span className="relative flex h-1.5 w-1.5">
                {aroundNow && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />}
                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${aroundNow ? 'bg-green-500' : 'bg-gray-400'}`} />
              </span>
              Around now
            </button>

            {([
              { id: 'coffee',   emoji: '☕', label: 'Coffee'   },
              { id: 'language', emoji: '🗣️', label: 'Language' },
              { id: 'hosting',  emoji: '🏠', label: 'Hosting'  },
            ] as const).map(o => {
              const active = openToFilter === o.id
              return (
                <button
                  key={o.id}
                  onClick={() => setOpenToFilter(active ? '' : o.id)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-all ${
                    active
                      ? 'bg-amber-50 text-amber-700 border-amber-300'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-amber-200'
                  }`}
                  title={`Members open to ${o.label.toLowerCase()}`}
                >
                  <span>{o.emoji}</span> {o.label}
                </button>
              )
            })}

            {/* "Speaks my language" — same filter the hangouts feed has. */}
            <button
              onClick={() => setSpeaksMyLang(v => !v)}
              aria-pressed={speaksMyLang}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-all ${
                speaksMyLang
                  ? 'bg-amber-50 text-amber-700 border-amber-300'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-amber-200'
              }`}
              title="Members who share a language with you"
            >
              <span>💬</span> My language
            </button>

            {/* "Looking for" — the registration answer, finally filterable. */}
            <select
              value={lookingForFilter}
              onChange={e => setLookingForFilter(e.target.value)}
              aria-label="Filter by what members are looking for"
              className={`px-3 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-all bg-white ${
                lookingForFilter ? 'text-amber-700 border-amber-300 bg-amber-50' : 'text-gray-600 border-gray-200'
              }`}
            >
              <option value="">Looking for…</option>
              {LOOKING_FOR_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>

            {/* Mobile-only flash-card view toggle — desktop always shows the grid */}
            <div className="w-px bg-gray-200 my-1.5 shrink-0 sm:hidden" />
            <button
              onClick={() => setView(v => v === 'cards' ? 'grid' : 'cards')}
              aria-pressed={view === 'cards'}
              className={`sm:hidden flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border whitespace-nowrap transition-all ${
                view === 'cards'
                  ? 'bg-amber-50 text-amber-700 border-amber-300'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-amber-200'
              }`}
              title="Browse members one at a time"
            >
              <span>🃏</span> Cards
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Contextual discovery (Members brief §5–6): people connected to
            the viewer's clubs, neighborhood and plans come FIRST; the
            full directory is demoted below. Hidden while a search or
            filter is active — the member is looking for someone specific
            then, not browsing. */}
        {!search && roleFilter === 'All' && !openToFilter && !aroundNow && !speaksMyLang && !lookingForFilter && (
          <MemberDiscovery />
        )}

        {/* §43 — the full directory, explicitly framed as the layer below
            contextual discovery. */}
        {!search && roleFilter === 'All' && !openToFilter && !aroundNow && !speaksMyLang && !lookingForFilter && (
          <div className="mb-4 pt-2 border-t border-gray-100">
            <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-gray-900 mt-6">Explore the community</h2>
            <p className="text-sm text-gray-600 mt-0.5">Everyone on Smileys — search, filter, browse.</p>
          </div>
        )}

        {/* Pending connection requests */}
        {pendingRequests.length > 0 && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-2xl p-4">
            <h2 className="text-sm font-bold text-amber-800 mb-3">
              🤝 {pendingRequests.length} connection request{pendingRequests.length !== 1 ? 's' : ''} waiting
            </h2>
            <div className="flex flex-col gap-2">
              {pendingRequests.map(req => {
                const inPage = members.find(x => x.id === req.requesterId)
                const u = inPage ?? req.requester
                if (!u) return null
                // Avatar + name block is identical between the in-page
                // (button → modal) and out-of-page (Link → /members/[id])
                // branches; only the wrapper element differs. Extract
                // once instead of two near-identical JSX trees.
                const avatarAndName = (
                  <>
                    {u.profilePhoto ? (
                      <img src={avatarUrl(u.profilePhoto, 64)} alt={u.name} loading="lazy" decoding="async" className="w-8 h-8 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: u.color }}>{getInitials(u.name)}</div>
                    )}
                    <span className="text-sm font-semibold text-gray-800 truncate">{u.name}</span>
                  </>
                )
                return (
                  <div key={req.id} className="flex items-center gap-3 bg-white border border-amber-200 rounded-xl px-3 py-2.5">
                    {inPage ? (
                      <button onClick={() => setSelected(inPage)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                        {avatarAndName}
                      </button>
                    ) : (
                      <Link href={`/members/${u.id}`} className="flex items-center gap-2 flex-1 min-w-0">
                        {avatarAndName}
                      </Link>
                    )}
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handlePendingAction(req.id, 'accept', firstNameOf(u.name))}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition-colors">
                        Accept
                      </button>
                      <button
                        onClick={() => handlePendingAction(req.id, 'decline', firstNameOf(u.name))}
                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold rounded-lg transition-colors">
                        Decline
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* My connections summary */}
        {connectedCount > 0 && !loading && (
          <p className="text-xs text-gray-400 mb-4">
            You're connected with {connectedCount} member{connectedCount !== 1 ? 's' : ''}
          </p>
        )}

        {(loading || filterLoading) && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {!loading && !filterLoading && visible.length === 0 && (
          <EmptyState
            icon="🔍"
            title="No members found"
            body="Try a different name, neighborhood, or interest."
            action={{ label: 'Clear search', onClick: () => { setSearch(''); setRoleFilter('All') } }}
          />
        )}

        {!loading && !filterLoading && visible.length > 0 && (
          <>
            {view === 'cards' && (
              <div className="sm:hidden">
                <MemberFlashCards
                  members={visible}
                  currentUserId={user.id}
                  connections={connections}
                  onConnectionChange={handleConnectionChange}
                  onSelect={handleSelectMember}
                  getConnectionStatus={getConnectionStatus}
                  onNearEnd={handleDeckNearEnd}
                />
              </div>
            )}
            <div className={`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 ${view === 'cards' ? 'hidden sm:grid' : 'grid'}`}>
              {visible.map(m => (
                <MemberCard key={m.id} m={m} onSelect={handleSelectMember} connectionStatus={getConnectionStatus(m.id)} hangingOut={hangoutHostIds.has(m.id)} />
              ))}
            </div>
            {hasMore && !search && roleFilter === 'All' && (
              // Deck auto-paginates, so the manual button is desktop/grid-only
              // while cards view is active on mobile.
              <div className={`flex-col items-center gap-2 mt-8 ${view === 'cards' ? 'hidden sm:flex' : 'flex'}`}>
                <p className="text-sm text-gray-400">Showing {members.length} of {total} members</p>
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
                >
                  {loadingMore ? 'Loading…' : 'Load more members'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
