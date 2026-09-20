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
import { notifyConnectionsChanged } from '@/lib/pendingConnections'
import { fold } from '@/lib/turkishFold'
import {
  ROLE_FILTERS, buildMemberQuery, filtersActive as queryNarrowed,
  mergeById, seesProfileOf, foldedIncludes,
  type RoleFilter, type SortOption, type OpenToFilter,
} from './memberList'

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
  // A locked card carries no joined date, role or membership tier — the
  // API stopped sending them, so nothing here may assume they arrived.
  joinedAt?: string | null
  role?: string | null
  isHost: boolean
  clubs: MemberClub[]
  eventsCount: number
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

// "Joined Sep 2026" — or nothing at all when the card didn't come with a
// date (a locked card doesn't), rather than "Invalid Date".
function joinedLabel(joinedAt: string | null | undefined): string | null {
  if (!joinedAt) return null
  const d = new Date(joinedAt)
  if (Number.isNaN(d.getTime())) return null
  // 'numeric', not '2-digit': "Sep 26" reads as the 26th of September,
  // not September 2026.
  return `Joined ${d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
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
        // Already withdrawn from the other side — there's nothing to
        // accept and nothing the member did wrong. Clear the row.
        if (res.status === 404) {
          onConnectionChange(null, conn.id)
          return
        }
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
        // 404 means the row is already gone — the other side declined or
        // withdrew while this button sat there saying "Pending…". Drop it
        // from state; an error toast would blame the member for a state
        // that simply moved on.
        if (res.status === 404) {
          onConnectionChange(null, conn.id)
          return
        }
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

function MemberModal({ m, onClose, currentUserId, currentUserRole, viewerPrivileged, myClubIds, connections, onConnectionChange, onBlocked, isSaved, onToggleSave }: {
  m: Member; onClose: () => void; currentUserId: string; currentUserRole: string
  viewerPrivileged: boolean
  myClubIds: string[]
  connections: ConnectionRecord[]
  onConnectionChange: (updated: ConnectionRecord | null, removed?: string) => void
  onBlocked: (memberId: string) => void
  isSaved: boolean
  onToggleSave: (memberId: string) => void
}) {
  const flag        = countryFlag(m.nationality)
  const photo       = resolveImageUrl(m.profilePhoto)
  const role        = displayRole(m)
  const joined      = joinedLabel(m.joinedAt)

  // Admins, moderators, and club hosts see full profiles regardless of
  // connection. currentUserRole still drives nothing else here.
  const isPrivileged = viewerPrivileged || currentUserRole === 'admin' || currentUserRole === 'moderator'

  const conn = connections.find(c =>
    (c.requesterId === currentUserId && c.receiverId === m.id) ||
    (c.receiverId === currentUserId && c.requesterId === m.id)
  )
  const isConnected = isPrivileged || conn?.status === 'accepted'
  const isSelf      = m.id === currentUserId
  // Same rule as the grid card and the flash-card deck — this modal used
  // to gate everything on isConnected and tell a member their public
  // neighbour's bio was private while the card behind it showed that bio.
  const seesProfile = isSelf || seesProfileOf(m, isConnected)

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
      // The API hides a blocked pair from each other from here on, so the
      // card, their pending request and their hangout have to go too —
      // otherwise Accept 404s on a request that shouldn't be on screen.
      onBlocked(m.id)
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
    // Hold the page still underneath. Without this a scroll gesture that
    // starts on the backdrop — or runs off the end of the panel — scrolls
    // the grid behind, and closing the modal drops the member somewhere
    // else in the directory.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      triggerRef.current?.focus()
    }
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
    // z-[60], like the QR scanner: the bottom nav is also z-50 and paints
    // later, so at z-50 it sat on top of the card on a phone.
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center md:p-6" onClick={onClose}>
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
                    {seesProfile ? m.name : firstNameOf(m.name)}
                    {seesProfile && flag && <span className="ml-1.5 text-base font-normal">{flag}</span>}
                  </h2>
                  <MembershipBadge membershipType={m.membershipType} className="shrink-0 text-[10px] px-2 py-0.5" />
                  {m.foundingMember && (
                    <span className="shrink-0 text-[10px] font-semibold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">⭐ Founding</span>
                  )}
                  {/* Role badge only when it carries information — plain
                      'Member' is the default and just eats space. */}
                  {(m.isHost || m.role === 'admin' || m.role === 'moderator') && roleBadge}
                </div>
                {/* A locked card has no neighbourhood and no joined date to
                    show, so this line disappears rather than printing
                    "Joined Invalid Date". */}
                {(seesProfile && m.neighborhood) || joined ? (
                  <p className="text-xs text-gray-400 mt-1.5">
                    {seesProfile && m.neighborhood ? <>📍 {m.neighborhood}{joined ? ' · ' : ''}</> : null}
                    {joined}
                  </p>
                ) : null}
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

            {/* Save + the way out to the full profile. Nothing on this page
                could save anyone before, which left the Saved filter with
                an empty shelf, and nothing linked to /members/[id] — the
                page with shared context, hosted events and hangouts. */}
            <div className="flex items-center justify-between gap-3 mt-3">
              {!isSelf ? (
                <button
                  onClick={() => onToggleSave(m.id)}
                  aria-pressed={isSaved}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                    isSaved
                      ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-amber-200 hover:text-amber-700'
                  }`}>
                  <span aria-hidden="true">🔖</span> {isSaved ? 'Saved' : 'Save'}
                </button>
              ) : <span />}
              <Link href={`/members/${m.id}`} onClick={onClose}
                className="text-xs font-bold text-amber-600 hover:text-amber-700">
                View full profile →
              </Link>
            </div>
          </div>

          {/* Locked state — only for a 'connections only' member the viewer
              isn't connected to. A public profile is shown in full below,
              exactly as the card behind this modal and /members/[id] show
              it; what a connection adds is Instagram, LinkedIn and work
              details, and that's all this used to claim it added. */}
          {!seesProfile && (
            <div className="px-4 pb-5 pt-3 flex flex-col items-center text-center gap-2">
              <div className="text-3xl">🔒</div>
              <p className="text-sm font-semibold text-gray-700">This profile is private</p>
              <p className="text-xs text-gray-400">{firstNameOf(m.name)} keeps their profile to connections only. Send a request — once they accept, you’ll see their full profile.</p>
            </div>
          )}

          {/* Full profile — anyone whose profile this viewer may see */}
          {seesProfile && (
            <>
              {/* Stats row — flag/neighborhood/joined moved into the header,
                  so this is just the activity numbers now */}
              <div className="flex divide-x divide-gray-100 border-y border-gray-100 mx-4 my-3">
                <div className="flex-1 py-2 text-center">
                  <p className="text-sm font-extrabold text-gray-900">🎟 {m.eventsCount}</p>
                  {/* Was "N shared", counted from an eventIds array the API
                      has never sent — so it read 0 shared for everyone. */}
                  <p className="text-xs text-gray-400">Events</p>
                </div>
                <div className="flex-1 py-2 text-center">
                  <p className="text-sm font-extrabold text-gray-900">🏛 {m.clubs.length}</p>
                  {/* Without a connection the API sends only the clubs
                      they host, so "Clubs" would be counting a fraction
                      of their membership and calling it the whole. */}
                  <p className="text-xs text-gray-400">{isConnected || isSelf ? 'Clubs' : 'Clubs hosted'}</p>
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

                {/* What a connection actually adds, now that the rest of
                    the profile is no longer claimed to be behind it. */}
                {!isConnected && !isSelf && (
                  <p className="text-xs text-gray-400">
                    <span aria-hidden="true">🔒</span> Instagram, LinkedIn and work details unlock once you connect.
                  </p>
                )}

                {!isSelf && (
                  <div className="pt-2 border-t border-gray-100 flex items-center gap-4">
                    <ReportButton reportedId={m.id} reportedName={m.name} />
                    <span className="w-px h-3 bg-gray-200 shrink-0" />
                    {blockButton}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Report + Block — the locked card has no profile body to hang
              them off, so they get their own row. */}
          {!seesProfile && (
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
  // Same rule as the modal and the deck: a public member reads as
  // themselves to every member; only a locked card is trimmed back.
  const seesProfile = seesProfileOf(m, isConnected)
  const joined      = joinedLabel(m.joinedAt)

  const displayName = seesProfile ? m.name : firstNameOf(m.name)

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
          {seesProfile && m.neighborhood && (
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
            // Only clubs they host come back without a connection, so the
            // tooltip says which number this is.
            <span className="flex items-center gap-0.5"
              title={isConnected ? `${m.clubs.length} clubs` : `Hosts ${m.clubs.length} club${m.clubs.length !== 1 ? 's' : ''}`}>
              <span>🏛</span> {m.clubs.length}
            </span>
          )}
          {/* A locked card carries no joined date — printing one would be
              printing "Invalid Date". */}
          {joined && (
            <span className="ml-auto text-[10px] text-gray-300">
              {joined.replace('Joined ', '')}
            </span>
          )}
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
function MemberFlashCards({ members, currentUserId, connections, onConnectionChange, onSelect, getConnectionStatus, onNearEnd, resetKey }: {
  members: Member[]
  currentUserId: string
  connections: ConnectionRecord[]
  onConnectionChange: (updated: ConnectionRecord | null, removed?: string) => void
  onSelect: (m: Member) => void
  getConnectionStatus: (id: string) => string | undefined
  onNearEnd?: () => void
  // Changes whenever the query behind the deck changes (filters, search,
  // sort). A new list means a new first card — staying on card 14 of the
  // old one left the member looking at someone the filter didn't ask for.
  resetKey: string
}) {
  const [index, setIndex] = useState(0)
  const [dx, setDx] = useState(0)
  const touchX = useRef<number | null>(null)

  useEffect(() => { setIndex(0) }, [resetKey])

  // Filters can shrink the list under the cursor — clamp, don't crash.
  const i = members.length ? Math.min(index, members.length - 1) : 0
  const m: Member | undefined = members[i]

  useEffect(() => {
    if (onNearEnd && members.length > 0 && members.length - i <= 5) onNearEnd()
  }, [i, members.length, onNearEnd])

  if (!m) return null

  const status      = getConnectionStatus(m.id)
  const isConnected = status === 'accepted' || status === 'privileged'
  // A public profile's bio, interests and (if listed) neighbourhood are for
  // every member, as on the profile page; the API already withholds what a
  // viewer may not see.
  const isSelf      = m.id === currentUserId
  const seesProfile = isSelf || seesProfileOf(m, isConnected)
  const flag        = countryFlag(m.nationality)
  const photo       = resolveImageUrl(m.profilePhoto)
  const displayName = seesProfile ? m.name : firstNameOf(m.name)
  const joined      = joinedLabel(m.joinedAt)

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
              {(seesProfile && m.neighborhood) || joined ? (
                <p className="text-white/80 text-xs mt-0.5">
                  {seesProfile && m.neighborhood ? `📍 ${m.neighborhood}${joined ? ' · ' : ''}` : ''}
                  {joined}
                </p>
              ) : null}
            </div>
            {m.isHost && <span className="absolute top-3 left-3 text-[10px] font-bold px-2 py-1 rounded-full bg-blue-500 text-white shadow-sm">Host</span>}
            {m.restricted && (
              <span className="absolute top-3 right-3 flex items-center gap-0.5 bg-gray-900/70 text-white text-[10px] font-bold px-2 py-1 rounded-full backdrop-blur-sm">🔒 Private</span>
            )}
          </div>
        </button>

        <div className="p-4 space-y-3">
          {seesProfile && m.bio ? (
            <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">{m.bio}</p>
          ) : !isConnected && !isSelf ? (
            <p className="text-xs text-gray-400">
              <span aria-hidden="true">🔒</span> {m.restricted ? `${displayName} keeps their profile to connections only.` : 'Instagram, LinkedIn and work details unlock once you connect.'}
            </p>
          ) : null}

          {seesProfile && m.interests.length > 0 && (
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
        {/* Announced, because on a phone this counter is the only thing
            that says the deck moved — the card itself is a picture. */}
        <p className="text-xs text-gray-400 font-medium" aria-live="polite" aria-atomic="true">
          <span aria-hidden="true">{i + 1} / {members.length}</span>
          <span className="sr-only">{displayName}, member {i + 1} of {members.length}</span>
        </p>
        <button onClick={() => go(1)} disabled={i === members.length - 1} aria-label="Next member"
          className="w-11 h-11 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-600 disabled:opacity-30">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
    </div>
  )
}

export default function MembersPage() {
  return <Suspense><MembersPageInner /></Suspense>
}

function MembersPageInner() {
  const searchParams   = useSearchParams()
  const neighborhoodParam = searchParams.get('neighborhood') ?? ''
  const { user } = useAuth()
  // One list, whatever the query. The old second list (filteredMembers)
  // is what made "Showing N of M" and "Load more" count the unfiltered
  // directory while the grid showed a filtered page.
  const [members,      setMembers]      = useState<Member[]>([])
  // `total` describes whatever query is on screen; `directoryTotal` is the
  // whole city, which is what the hero line and the All pill mean.
  const [total,        setTotal]        = useState(0)
  const [directoryTotal, setDirectoryTotal] = useState(0)
  const [hostTotal,    setHostTotal]    = useState(0)
  const [adminTotal,   setAdminTotal]   = useState(0)
  const [savedTotal,   setSavedTotal]   = useState(0)
  const [hasMore,      setHasMore]      = useState(false)
  const [loadingMore,  setLoadingMore]  = useState(false)
  const [loading,      setLoading]      = useState(true)
  const [listLoading,  setListLoading]  = useState(false)
  // What went wrong with the last list fetch, so the page can say so
  // instead of claiming the directory is empty. 429 gets its own copy.
  const [listError,    setListError]    = useState<'rate-limit' | 'failed' | null>(null)
  // Who this viewer has bookmarked. Once the list has landed it — not the
  // count that came with the member page — is what the Saved pill counts,
  // so a save made here shows up without a refetch.
  const [savedIds,     setSavedIds]     = useState<Set<string>>(new Set())
  const [savedLoaded,  setSavedLoaded]  = useState(false)
  const [search,       setSearch]       = useState(neighborhoodParam)
  const [roleFilter,   setRoleFilter]   = useState<RoleFilter>('All')
  // ?openTo= filter — only one active at a time (matches the role-pill UX).
  const [openToFilter, setOpenToFilter] = useState<OpenToFilter>('')
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

  // The rows on screen, readable from callbacks that mustn't re-bind on
  // every list change (they'd re-render every card).
  const membersRef = useRef<Member[]>([])
  useEffect(() => { membersRef.current = members }, [members])

  // Accepting flips what the API will send for that member: the row we
  // hold was redacted when it arrived, so the modal would draw the full
  // profile over a pile of nulls. Ask for that one member again by id — a
  // name search would find whoever else shares the name — and swap the fresh
  // row in, modal included. A miss leaves the stale row: nothing to tell the
  // member.
  const refreshMember = useCallback(async (memberId: string) => {
    if (!memberId) return
    try {
      const res = await fetch(`/app/api/members?ids=${encodeURIComponent(memberId)}`, { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      const fresh: Member | undefined = (Array.isArray(data?.members) ? data.members : []).find((x: Member) => x.id === memberId)
      if (!fresh) return
      setMembers(prev => prev.map(x => (x.id === memberId ? fresh : x)))
      setSelected(prev => (prev && prev.id === memberId ? fresh : prev))
    } catch { /* keep what we have */ }
  }, [])

  const handleConnectionChange = useCallback((updated: ConnectionRecord | null, removed?: string) => {
    // Every accept / decline / withdraw on this page funnels through here —
    // the nav's pending badge keeps its own count and needs telling.
    notifyConnectionsChanged()
    if (removed) {
      setConnections(prev => prev.filter(c => c.id !== removed))
    } else if (updated) {
      setConnections(prev => {
        const idx = prev.findIndex(c => c.id === updated.id)
        if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next }
        return [...prev, updated]
      })
      if (updated.status === 'accepted') {
        const otherId = updated.requesterId === user.id ? updated.receiverId : updated.requesterId
        refreshMember(otherId)
      }
    }
  }, [refreshMember, user.id])

  // A block hides the pair from each other everywhere else, so the page
  // has to let go too: the card, their still-visible pending request
  // (whose Accept would 404) and their hangout.
  const handleBlocked = useCallback((memberId: string) => {
    setMembers(prev => prev.filter(m => m.id !== memberId))
    // The server deletes the save both ways; the pill would otherwise keep
    // counting them until a reload.
    setSavedIds(prev => { if (!prev.has(memberId)) return prev; const next = new Set(prev); next.delete(memberId); return next })
    setTotal(t => Math.max(0, t - 1))
    setDirectoryTotal(t => Math.max(0, t - 1))
    setConnections(prev => prev.filter(c => c.requesterId !== memberId && c.receiverId !== memberId))
    setHangouts(prev => prev.filter(h => h.user.id !== memberId))
    notifyConnectionsChanged()
  }, [])

  // Save / unsave from the modal. One POST toggles and answers with the
  // side it landed on; the optimistic flip is rolled back if it doesn't.
  const savedRef = useRef<Set<string>>(new Set())
  useEffect(() => { savedRef.current = savedIds }, [savedIds])
  const handleToggleSave = useCallback(async (memberId: string) => {
    const wasSaved = savedRef.current.has(memberId)
    const flip = (saved: boolean) => setSavedIds(prev => {
      const next = new Set(prev)
      if (saved) next.add(memberId); else next.delete(memberId)
      return next
    })
    flip(!wasSaved)
    try {
      const res = await fetch('/app/api/members/saved', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId }),
      })
      if (!res.ok) throw new Error(String(res.status))
      // The toggle decides which side it landed on, not us — a double tap
      // or a save made in another tab can disagree with the guess.
      const data = await res.json().catch(() => null)
      if (typeof data?.saved === 'boolean') flip(data.saved)
    } catch {
      flip(wasSaved)
      toast.error(wasSaved ? 'Could not remove that bookmark' : 'Could not save that member')
    }
  }, [])

  // Pending Accept/Decline helper — was two inline arrow functions per
  // request with no res.ok check and no toast on failure (silent failure
  // pattern we just fixed on clubs). Single helper handles both actions
  // with try/catch/finally + toast feedback.
  const pendingBusy = useRef(new Set<string>())
  const [pendingBusyIds, setPendingBusyIds] = useState<Set<string>>(new Set())
  const handlePendingAction = useCallback(async (reqId: string, action: 'accept' | 'decline', firstName: string) => {
    // A double tap fired two PATCHes; the second failed with "Could not
    // accept request" right after "Connected with X".
    if (pendingBusy.current.has(reqId)) return
    pendingBusy.current.add(reqId)
    setPendingBusyIds(new Set(pendingBusy.current))
    try {
      const res = await fetch(`/app/api/connections/${reqId}`, {
        method:  'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
      })
      if (!res.ok) {
        // Gone already (withdrawn, or the pair blocked each other) — drop
        // the row rather than accusing the member of a failed tap.
        if (res.status === 404) {
          handleConnectionChange(null, reqId)
          return
        }
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
    } finally {
      pendingBusy.current.delete(reqId)
      setPendingBusyIds(new Set(pendingBusy.current))
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
      fetch('/app/api/clubs/memberships', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/app/api/connections',       { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/app/api/hangouts',          { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/app/api/members/saved',     { credentials: 'include' }).then(r => r.json()).catch(() => null),
    ]).then(([content, clubsData, connData, hangoutsData, savedData]) => {
      if (content?.members) setHero(h => ({ ...h, ...content.members }))
      setMyClubIds(Array.isArray(clubsData) ? clubsData.map((c: any) => c.clubId ?? c.id) : [])
      const sentList = Array.isArray(connData?.sent)     ? connData.sent     : []
      const rcvList  = Array.isArray(connData?.received) ? connData.received : []
      setConnections([...sentList, ...rcvList])
      setHangouts(Array.isArray(hangoutsData?.hangouts) ? hangoutsData.hangouts : [])
      if (Array.isArray(savedData?.savedIds)) {
        setSavedIds(new Set<string>(savedData.savedIds))
        setSavedLoaded(true)
      }
    })
  }, [])

  const trimmedSearch = search.trim()
  const query = useMemo(
    () => ({ roleFilter, openTo: openToFilter, aroundNow, speaksMyLang, lookingFor: lookingForFilter, search, sort }),
    [roleFilter, openToFilter, aroundNow, speaksMyLang, lookingForFilter, search, sort],
  )
  const filtersActive = queryNarrowed(query)
  const queryParams   = useCallback((offset: number) => buildMemberQuery(query, offset), [query])

  // Identifies the query a response belongs to, so a page that lands
  // after the member changed a filter is dropped instead of appended.
  const queryKey = queryParams(0).toString()
  const queryKeyRef = useRef(queryKey)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    queryKeyRef.current = queryKey
    // Debounce search input so typing "yasemin" fires one fetch, not seven.
    // Filter clicks don't need debouncing but route through the same timer.
    const delay = trimmedSearch ? 250 : 0
    // Abort the in-flight fetch on filter change — without it a slow
    // response could land over a newer one.
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      // §55 — search/filter usage. Debounced with the fetch so we log
      // intents, not keystrokes.
      if (trimmedSearch) posthog.capture('member_search', { length: trimmedSearch.length })
      if (roleFilter !== 'All' || openToFilter || aroundNow || speaksMyLang || lookingForFilter) {
        posthog.capture('member_filter_used', { role: roleFilter, openTo: openToFilter || null, aroundNow, speaksMyLang, lookingFor: lookingForFilter || null })
      }
      setListLoading(true)
      try {
        const res = await fetch(`/app/api/members?${queryParams(0)}`, { credentials: 'include', signal: ctrl.signal })
        if (!res.ok) {
          // Every failure used to render as "No members found" — an empty
          // directory is a very different thing from a request that was
          // turned away, and the member can act on one of them.
          setListError(res.status === 429 ? 'rate-limit' : 'failed')
          return
        }
        const d = await res.json()
        setListError(null)
        setMembers(Array.isArray(d?.members) ? d.members : [])
        setTotal(d?.total ?? 0)
        // With no filter on, this query IS the directory.
        if (!filtersActive) setDirectoryTotal(d?.total ?? 0)
        setHostTotal(d?.hostTotal ?? 0)
        setAdminTotal(d?.adminTotal ?? 0)
        setSavedTotal(d?.savedTotal ?? 0)
        setHasMore(!!d?.hasMore)
      } catch (e: unknown) {
        if ((e as Error)?.name === 'AbortError') return
        setListError('failed')
      } finally {
        if (!ctrl.signal.aborted) { setListLoading(false); setLoading(false) }
      }
    }, delay)
    return () => { clearTimeout(t); ctrl.abort() }
    // queryParams carries every filter; reloadToken is the Retry button.
  }, [queryParams, queryKey, filtersActive, reloadToken, roleFilter, openToFilter, aroundNow, speaksMyLang, lookingForFilter, trimmedSearch])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    const key = queryKeyRef.current
    setLoadingMore(true)
    try {
      const res = await fetch(`/app/api/members?${queryParams(membersRef.current.length)}`, { credentials: 'include' })
      if (!res.ok) {
        toast.error(res.status === 429
          ? 'You’re going faster than we can load — give it a moment.'
          : 'Could not load more members')
        return
      }
      const data = await res.json()
      // The filter moved while this page was in flight; it belongs to a
      // list that's no longer on screen.
      if (queryKeyRef.current !== key) return
      if (Array.isArray(data?.members)) {
        setMembers(prev => mergeById(prev, data.members))
        setTotal(data?.total ?? 0)
        setHasMore(!!data?.hasMore)
      }
    } catch {
      // A network blip used to throw past setLoadingMore and freeze the
      // button in its loading state until a full reload.
      toast.error('Could not load more members')
    } finally {
      setLoadingMore(false)
    }
  }, [hasMore, loadingMore, queryParams])

  // "Happening now" has to mean started. A plan for next Saturday is a
  // hangout too, but it isn't live, and the strip claimed it was.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  const liveHangouts = useMemo(
    () => hangouts.filter(h => new Date(h.startsAt).getTime() <= now && new Date(h.endsAt).getTime() >= now),
    [hangouts, now],
  )
  const hangoutHostIds = useMemo(() => new Set(liveHangouts.map(h => h.user.id)), [liveHangouts])

  const visible = useMemo(() => {
    // The server did the matching and the ordering (it can see the fields
    // a redacted card hides, and the whole directory rather than the
    // hundred rows loaded here). All this does is keep the browser from
    // dropping a row the server just matched, and tier name matches above
    // the rest — searching "Levent" (a common Turkish name AND an
    // Istanbul district) buried the actual Levents under everyone who
    // lives there.
    const q = fold(search)
    if (!q) return members

    const nameHit  = (m: Member) => foldedIncludes(m.name, q)
    const otherHit = (m: Member) =>
      foldedIncludes(m.nationality, q) ||
      m.interests.some(i => foldedIncludes(i, q)) ||
      m.clubs.some(c => foldedIncludes(c.name, q))
    // A locked card carries a first name and nothing else, so there's no
    // way to tell here why the server matched it. Trust the server.
    const relevance = (m: Member) => (nameHit(m) ? 0 : otherHit(m) || m.restricted ? 1 : 2)

    // Stable, and applied to the whole list as one: sorting on every change
    // let a second page lift its name matches above rows the reader was
    // already looking at — the same reshuffle that moving sort to the server
    // was meant to end. `sort` is stable in every engine we target, so rows
    // of equal relevance keep the order the server sent them in.
    return [...members].sort((a, b) => relevance(a) - relevance(b))
  }, [members, search])

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
  // loaded list, fetch the next page — of whatever query is on screen.
  // The guard used to exclude filtered lists, which meant a short filtered
  // deck kept firing against the unfiltered directory and walked the whole
  // thing into the rate limit. `hasMore` now describes the filtered set,
  // so an exhausted list simply stops asking.
  const handleDeckNearEnd = useCallback(() => {
    if (hasMore && !loadingMore && !listLoading) loadMore()
  }, [hasMore, loadingMore, listLoading, loadMore])

  // "Clear search" cleared the search box and the role pill and left the
  // other four filters on, so the grid stayed empty and the button looked
  // broken. This clears everything the grid is narrowed by.
  const clearAllFilters = useCallback(() => {
    setSearch('')
    setRoleFilter('All')
    setOpenToFilter('')
    setAroundNow(false)
    setSpeaksMyLang(false)
    setLookingForFilter('')
  }, [])

  // What's narrowing the list right now, in the words on the pills — an
  // empty grid should say which filter emptied it.
  const activeFilterLabels = useMemo(() => {
    const labels: string[] = []
    if (trimmedSearch)        labels.push(`“${trimmedSearch}”`)
    if (roleFilter !== 'All') labels.push(roleFilter)
    if (openToFilter)         labels.push(`open to ${openToFilter}`)
    if (aroundNow)            labels.push('around now')
    if (speaksMyLang)         labels.push('my language')
    if (lookingForFilter)     labels.push(LOOKING_FOR_LABELS[lookingForFilter] ?? lookingForFilter)
    return labels
  }, [trimmedSearch, roleFilter, openToFilter, aroundNow, speaksMyLang, lookingForFilter])

  const busy = loading || listLoading

  return (
    <div className="min-h-screen bg-warm pb-20 md:pb-0">
      {selected && <MemberModal m={selected} onClose={() => setSelected(null)} currentUserId={user.id} currentUserRole={user.role} viewerPrivileged={isPrivilegedUser} myClubIds={myClubIds} connections={connections} onConnectionChange={handleConnectionChange} onBlocked={handleBlocked} isSaved={savedIds.has(selected.id)} onToggleSave={handleToggleSave} />}

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
              {/* The whole city, not the filtered query — the count under
                  the headline answers "how big is this community". */}
              {!loading && <p className="text-sm text-gray-400 mt-1">{directoryTotal} members</p>}
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
          {/* "Happening now" only when something has actually started —
              the feed carries plans up to 14 days out, and all of them
              used to be announced as live. */}
          {hangouts.length > 0 && (() => {
            const live  = liveHangouts.length > 0
            const shown = live ? liveHangouts : hangouts
            return (
              <Link href="/hangouts" className="block mb-4 group">
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-2xl px-4 py-3 flex items-center gap-3 hover:from-amber-100 hover:to-orange-100 transition-colors">
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`w-2 h-2 rounded-full ${live ? 'bg-amber-500 animate-pulse' : 'bg-amber-300'}`} />
                    <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">{live ? 'Live' : 'Soon'}</span>
                  </div>
                  <p className="text-sm text-amber-900 flex-1 truncate">
                    <strong>{shown.length}</strong> hangout{shown.length !== 1 ? 's' : ''} {live ? 'happening now' : 'coming up'}
                    {shown[0]?.neighborhood && (
                      <span className="text-amber-700 font-normal"> · {live ? 'in' : 'starting in'} {shown[0].neighborhood}</span>
                    )}
                  </p>
                  <span className="text-xs font-bold text-amber-600 shrink-0 group-hover:translate-x-0.5 transition-transform">See all →</span>
                </div>
              </Link>
            )
          })()}

          {/* Role + open-to filter pills. The role pills swap the whole
              grid view (only one active at a time), so they get proper
              role=tablist / role=tab / aria-selected. The open-to pills
              are toggle filters and stay plain buttons. `display:contents`
              on the tablist lets the inner role pills keep flowing in the
              parent flex wrap. */}
          <div className="flex flex-wrap gap-2 pb-4">
            <div role="tablist" aria-label="Filter members by role" className="contents">
              {ROLE_FILTERS.map((f, idx) => {
                // The All pill counts the directory, not the query on
                // screen; Saved counts what this viewer has bookmarked,
                // which the save toggle changes without a refetch.
                const count = f === 'Hosts' ? hostTotal : f === 'Admins' ? adminTotal : f === 'Saved' ? (savedLoaded ? savedIds.size : savedTotal) : directoryTotal
                const isActive = roleFilter === f
                // All four role pills share the same active style now (was
                // gray-900 for All, violet-500 for Admins, amber-400 for
                // Saved, amber-500 for Hosts). The emoji prefix carries the
                // role differentiation; the chip itself stays in one palette.
                return (
                  <button
                    key={f}
                    id={`member-role-tab-${f}`}
                    onClick={() => setRoleFilter(f)}
                    role="tab"
                    aria-selected={isActive}
                    // The grid below is the panel these tabs swap, and a
                    // tablist without one is a lie to a screen reader.
                    aria-controls="members-results"
                    // Roving tabindex + arrow keys: a tablist is one stop
                    // in the tab order, and Left/Right move within it.
                    tabIndex={isActive ? 0 : -1}
                    onKeyDown={e => {
                      const next =
                        e.key === 'ArrowRight' ? (idx + 1) % ROLE_FILTERS.length :
                        e.key === 'ArrowLeft'  ? (idx - 1 + ROLE_FILTERS.length) % ROLE_FILTERS.length :
                        e.key === 'Home'       ? 0 :
                        e.key === 'End'        ? ROLE_FILTERS.length - 1 : null
                      if (next === null) return
                      e.preventDefault()
                      setRoleFilter(ROLE_FILTERS[next])
                      document.getElementById(`member-role-tab-${ROLE_FILTERS[next]}`)?.focus()
                    }}
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
        {!filtersActive && (
          <MemberDiscovery />
        )}

        {/* §43 — the full directory, explicitly framed as the layer below
            contextual discovery. */}
        {!filtersActive && (
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
                        disabled={pendingBusyIds.has(req.id)}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50">
                        Accept
                      </button>
                      <button
                        onClick={() => handlePendingAction(req.id, 'decline', firstNameOf(u.name))}
                        disabled={pendingBusyIds.has(req.id)}
                        className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50">
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

        {/* The panel the role tabs swap, and the one place the result
            count is announced — nothing told a screen-reader user that
            tapping a filter had changed anything. */}
        <div id="members-results" role="tabpanel" aria-labelledby={`member-role-tab-${roleFilter}`}>
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {busy ? 'Loading members…'
              : listError ? 'Could not load members.'
              : `${visible.length}${hasMore ? ` of ${total}` : ''} member${total === 1 ? '' : 's'} shown${activeFilterLabels.length ? ` for ${activeFilterLabels.join(', ')}` : ''}.`}
          </p>

          {busy && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {Array.from({ length: 12 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          )}

          {/* A failed request is not an empty directory. When there are
              still members on screen the list stays put and the banner
              sits above it; otherwise the failure takes the whole slot. */}
          {!busy && listError && (
            visible.length > 0 ? (
              <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
                <p className="text-sm text-amber-900 flex-1">
                  {listError === 'rate-limit'
                    ? 'You’re going faster than we can load. Showing what we already had.'
                    : 'Couldn’t refresh the list. Showing what we already had.'}
                </p>
                <button onClick={() => setReloadToken(t => t + 1)}
                  className="shrink-0 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors">
                  Retry
                </button>
              </div>
            ) : (
              <EmptyState
                icon={listError === 'rate-limit' ? '🐢' : '📡'}
                title={listError === 'rate-limit' ? 'Slow down a second' : 'Couldn’t load members'}
                body={listError === 'rate-limit'
                  ? 'You’re browsing faster than we can keep up. Give it a minute and try again.'
                  : 'Something went wrong on the way to the directory.'}
                action={{ label: 'Retry', onClick: () => setReloadToken(t => t + 1) }}
              />
            )
          )}

          {!busy && !listError && visible.length === 0 && (
            <EmptyState
              icon="🔍"
              title="No members found"
              body={activeFilterLabels.length
                ? `Nothing matches ${activeFilterLabels.join(' + ')}.`
                : 'There’s nobody here yet.'}
              action={activeFilterLabels.length
                ? { label: activeFilterLabels.length === 1 && trimmedSearch ? 'Clear search' : 'Clear all filters', onClick: clearAllFilters }
                : undefined}
            />
          )}

          {!busy && visible.length > 0 && (
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
                    resetKey={queryKey}
                  />
                </div>
              )}
              <div className={`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 ${view === 'cards' ? 'hidden sm:grid' : 'grid'}`}>
                {visible.map(m => (
                  <MemberCard key={m.id} m={m} onSelect={handleSelectMember} connectionStatus={getConnectionStatus(m.id)} hangingOut={hangoutHostIds.has(m.id)} />
                ))}
              </div>
              {/* Counts and paging follow the query on screen — both used
                  to read the unfiltered directory, so under a filter the
                  footer counted strangers and the button fetched pages
                  that never rendered. */}
              {hasMore && (
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
    </div>
  )
}
