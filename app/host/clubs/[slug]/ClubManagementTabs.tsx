'use client'

import { useState, useEffect } from 'react'
import { resolveImageUrl } from '@/lib/data'
import ClubAnnouncements from '@/components/ClubAnnouncements'
import ClubSpotlight     from '@/components/ClubSpotlight'
import ClubRulesEditor   from '@/components/ClubRulesEditor'
import ClubResources     from '@/components/ClubResources'
import ClubPhotos        from '@/components/ClubPhotos'

interface ClubResource { id: string; title: string; url: string; emoji: string; order: number; clubId: string; createdAt: Date | string }
interface Spotlight  { userId: string; name: string; color: string; photo: string | null; bio: string | null; note: string | null; updatedAt: string | null }

interface Props {
  slug:               string
  currentUserId:      string
  isAdmin:            boolean
  isPrivate:          boolean
  initialRules:       string | null
  initialResources:   ClubResource[]
  initialSpotlight:   Spotlight | null
}

interface JoinRequest {
  id: string; name: string; color: string; photo: string | null
  neighborhood: string | null; bio: string | null; requestedAt: string
}

interface ClubMember {
  id: string; role: string; firstName: string; fullName: string | null
  color: string; photo: string | null; neighborhood: string | null; connected: boolean
}

function MemberList({ slug }: { slug: string }) {
  const [members, setMembers] = useState<ClubMember[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/app/api/clubs/${slug}/members`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setMembers)
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) return <p className="text-zinc-500 text-sm py-8 text-center">Loading…</p>
  if (members.length === 0) return (
    <div className="py-12 text-center">
      <div className="text-3xl mb-2">👥</div>
      <p className="text-zinc-500 text-sm">No members yet.</p>
    </div>
  )

  const hosts   = members.filter(m => m.role === 'host')
  const regular = members.filter(m => m.role !== 'host')

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">{members.length} member{members.length !== 1 ? 's' : ''}</p>
      {[...hosts, ...regular].map(m => {
        const photo    = resolveImageUrl(m.photo)
        const display  = m.fullName ?? m.firstName
        const initials = display.trim().split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)
        return (
          <div key={m.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 flex items-center justify-center text-white font-bold text-xs"
              style={{ backgroundColor: m.color }}>
              {photo ? <img src={photo} alt={display} className="w-full h-full object-cover" /> : initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">{display}</p>
              {m.neighborhood && <p className="text-xs text-zinc-500 mt-0.5">📍 {m.neighborhood}</p>}
            </div>
            {m.role === 'host' && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 shrink-0">Host</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function MemberRequests({ slug }: { slug: string }) {
  const [requests, setRequests] = useState<JoinRequest[]>([])
  const [loading,  setLoading]  = useState(true)
  const [busy,     setBusy]     = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    fetch(`/app/api/clubs/${slug}/members?pending=1`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setRequests)
      .finally(() => setLoading(false))
  }, [slug])

  async function decide(userId: string, action: 'approve' | 'reject') {
    setBusy(userId)
    setError(null)
    const res = await fetch(`/app/api/clubs/${slug}/members`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action }),
    })
    if (res.ok) {
      setRequests(prev => prev.filter(r => r.id !== userId))
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Something went wrong. Please try again.')
    }
    setBusy(null)
  }

  if (loading) return <p className="text-zinc-500 text-sm py-8 text-center">Loading…</p>

  if (requests.length === 0) return (
    <div className="py-12 text-center">
      <div className="text-3xl mb-2">✅</div>
      <p className="text-zinc-500 text-sm">No pending join requests.</p>
    </div>
  )

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
      )}
      <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">
        {requests.length} pending request{requests.length !== 1 ? 's' : ''}
      </p>
      {requests.map(r => {
        const photo    = resolveImageUrl(r.photo)
        const initials = r.name.trim().split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
        return (
          <div key={r.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-start gap-4">
            {/* Avatar */}
            <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 flex items-center justify-center text-white font-bold text-sm"
              style={{ backgroundColor: r.color }}>
              {photo
                ? <img src={photo} alt={r.name} className="w-full h-full object-cover" />
                : initials}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-white text-sm">{r.name}</p>
              {r.neighborhood && <p className="text-xs text-zinc-500 mt-0.5">📍 {r.neighborhood}</p>}
              {r.bio && <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{r.bio}</p>}
              <p className="text-xs text-zinc-600 mt-1">
                Requested {new Date(r.requestedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 shrink-0">
              <button
                onClick={() => decide(r.id, 'approve')}
                disabled={busy === r.id}
                className="px-3 py-2 bg-green-500 hover:bg-green-600 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
              >
                {busy === r.id ? '…' : '✓ Approve'}
              </button>
              <button
                onClick={() => decide(r.id, 'reject')}
                disabled={busy === r.id}
                className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded-lg transition-colors disabled:opacity-50"
              >
                {busy === r.id ? '…' : '✕ Reject'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const BASE_TABS = [
  { key: 'announcements', label: '📢 Announcements' },
  { key: 'spotlight',     label: '⭐ Spotlight'     },
  { key: 'rules',         label: '📋 Rules'         },
  { key: 'resources',     label: '🔗 Resources'     },
  { key: 'photos',        label: '📸 Photos'        },
] as const

type BaseTab = typeof BASE_TABS[number]['key']
type Tab = BaseTab | 'members'

export default function ClubManagementTabs({
  slug, currentUserId, isAdmin, isPrivate, initialRules, initialResources, initialSpotlight,
}: Props) {
  const [tab, setTab] = useState<Tab>('announcements')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'members' as Tab, label: '👥 Members' },
    ...BASE_TABS,
  ]

  return (
    <div>
      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 mb-6 border-b border-zinc-800">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`pb-3 px-1 mr-3 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${
              tab === t.key
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-zinc-500 hover:text-zinc-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'members' && (
        <div className="space-y-8">
          {isPrivate && <MemberRequests slug={slug} />}
          <MemberList slug={slug} />
        </div>
      )}
      {tab === 'announcements' && (
        <ClubAnnouncements slug={slug} canAnnounce={true} currentUserId={currentUserId} isAdmin={isAdmin} dark />
      )}
      {tab === 'spotlight' && (
        <ClubSpotlight slug={slug} initialSpotlight={initialSpotlight} canEdit={true} dark />
      )}
      {tab === 'rules' && (
        <ClubRulesEditor slug={slug} initialRules={initialRules} canEdit={true} dark />
      )}
      {tab === 'resources' && (
        <ClubResources slug={slug} initialResources={initialResources} canEdit={true} dark />
      )}
      {tab === 'photos' && (
        <ClubPhotos slug={slug} canUpload={true} isMember={true} currentUserId={currentUserId} isAdmin={isAdmin} dark />
      )}
    </div>
  )
}
