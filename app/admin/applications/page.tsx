'use client'

import { toast } from 'sonner'

import Link from 'next/link'
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { resolveImageUrl } from '@/lib/data'

interface Application {
  id: string; fullName: string; email: string; phone: string | null
  birthdate: string | null; gender: string | null; country: string | null; city: string | null
  instagram: string | null; linkedin: string | null; profession: string | null
  timeInCity: string | null; reasonHere: string | null; whyJoin: string | null
  enjoyWith: string | null; goodCommunity: string | null; interests: string[]
  contribution: string | null; groupBehavior: string | null
  removedFromCommunity: string | null; toxicBehavior: string | null
  // New consolidated fields — preferred when present.
  aboutCommunity: string | null; socialJudgment: string | null
  languages: string[]
  openToCoffee: boolean; openToLanguage: boolean; openToHosting: boolean
  profilePhoto: string | null; suggestion: string | null; suggestedBy: string | null
  bio: string | null; source: string | null; referredBy: string | null; status: string
  reviewNote: string | null; createdAt: string; reviewer: { name: string } | null
  ipAddress: string | null; userAgent: string | null; fingerprint: string | null
  timezone: string | null; timezoneMismatch: boolean; disposableEmail: boolean
  referrer?: { name: string } | null
  escalated?: boolean; escalatedNote?: string | null
}

const STATUS: Record<string, string> = {
  pending:  'bg-amber-500/10 text-amber-400 border-amber-500/20',
  approved: 'bg-green-500/10 text-green-400 border-green-500/20',
  rejected: 'bg-red-500/10 text-red-400 border-red-500/20',
}

const CONTRIBUTION_LABEL: Record<string, string> = {
  host:     '🎖️ Wants to host',
  organize: '🤝 Help organize',
  attend:   '🎟️ Attend only',
}

const INTERESTS = ['sailing','dining','social','wellness','networking','languages','games','outdoor']

function score(app: Application): number {
  let s = 0
  const GENERIC = ['just meet','meet people','meet new people','make friends','socialize','hang out','networking opportunities','new connections']
  // Coalesce new + legacy essay fields so scoring works across both schemas.
  const essayText = [app.aboutCommunity, app.whyJoin, app.goodCommunity, app.enjoyWith].map(a => (a ?? '').toLowerCase()).join(' ')
  const essayLen  = (app.aboutCommunity?.length ?? 0) + (app.whyJoin?.length ?? 0) + (app.goodCommunity?.length ?? 0)
  const isGeneric = GENERIC.some(kw => essayText.includes(kw))
  if (essayLen > 200)                                        s += 20
  if (app.contribution === 'host' || app.contribution === 'organize') s += 15
  if (essayLen > 80 && !isGeneric)                           s += 20
  if (app.instagram || app.linkedin)                         s += 10
  if (!app.aboutCommunity && !app.whyJoin && !app.goodCommunity && !app.bio) s -= 30
  if (isGeneric)                                             s -= 15
  if (!app.profilePhoto)                                     s -= 40
  return Math.max(0, Math.min(100, s))
}

function Score({ app }: { app: Application }) {
  const s = score(app)
  if (s >= 80) return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">Strong fit</span>
  if (s >= 50) return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">Review</span>
  return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">Weak</span>
}

function Flag({ app }: { app: Application }) {
  const GENERIC  = ['just meet','meet people','meet new people','make friends','socialize','hang out']
  const combined = [app.aboutCommunity, app.whyJoin, app.goodCommunity, app.enjoyWith].map(a => (a ?? '').toLowerCase()).join(' ')
  const removed  = (app.removedFromCommunity ?? '').toLowerCase()
  if (removed && removed !== 'no' && removed.length > 2)
    return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">⚠️ Flagged</span>
  if (!app.aboutCommunity && !app.whyJoin && !app.goodCommunity && !app.bio)
    return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-400">Empty</span>
  if (GENERIC.some(kw => combined.includes(kw)))
    return <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-400">Generic</span>
  return null
}

function QA({ q, a }: { q: string; a: string | null }) {
  if (!a) return null
  return (
    <div>
      <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">{q}</p>
      <p className="text-sm text-zinc-300 leading-relaxed">{a}</p>
    </div>
  )
}

export default function AdminApplicationsPage() {
  return <Suspense><AdminApplicationsPageInner /></Suspense>
}

function AdminApplicationsPageInner() {
  const { user } = useAuth()
  const isMod = user?.role === 'moderator'
  const searchParams = useSearchParams()

  const [apps,          setApps]          = useState<Application[]>([])
  const [clubs,         setClubs]         = useState<{ id: string; name: string; emoji: string }[]>([])
  const [loading,       setLoading]       = useState(true)
  const [selected,      setSelected]      = useState<Application | null>(null)
  const [tab,           setTab]           = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [sortBy,        setSortBy]        = useState<'recent' | 'score'>('recent')
  const [filterInterest,setFilterInterest]= useState(searchParams.get('interest') ?? '')
  // ?contribution=host wires up to the host-pipeline link on
  // /admin/analytics?tab=members. The link was previously dead — the page
  // only read ?interest=. Now host-intent applications are one tap away
  // from the analytics tab that flagged them.
  const [filterContribution, setFilterContribution] = useState(searchParams.get('contribution') ?? '')
  const [reviewNote,    setReviewNote]    = useState('')
  const [rejectMsg,     setRejectMsg]     = useState('')
  const [assignedClubs, setAssignedClubs] = useState<string[]>([])
  const [defaultClubId, setDefaultClubId] = useState('')
  const [saving,        setSaving]        = useState(false)
  const [selected2,     setSelected2]     = useState<Set<string>>(new Set())
  const [bulkSaving,    setBulkSaving]    = useState(false)
  // Pipeline derived from `apps` (already loaded) instead of fetched from
  // /api/admin/analytics. Previously the page hit the heaviest endpoint
  // (~17 queries) just to render `total` + `approvalRate` — and read the
  // wrong fields (analytics returns `applications.total`, page read `.total`)
  // so the values were always undefined and the header bar never rendered.
  const [aiResult,      setAiResult]      = useState<{ recommendation: string; confidence: number; summary: string; strengths: string[]; redFlags: string[]; suggestedQuestions: string[] } | null>(null)
  const [aiLoading,     setAiLoading]     = useState(false)
  const [welcomeMsg,    setWelcomeMsg]    = useState('')
  const [welcomeLoading,setWelcomeLoading]= useState(false)

  function loadApps() {
    setLoading(true)
    const opts: RequestInit = { credentials: 'include', cache: 'no-store' }
    Promise.all([
      fetch('/app/api/admin/applications', opts).then(r => r.json()),
      fetch('/app/api/clubs',              opts).then(r => r.json()),
      fetch('/app/api/admin/settings',     opts).then(r => r.json()),
    ]).then(([appsData, clubData, settings]) => {
      if (!Array.isArray(appsData)) {
        console.error('[applications] API returned non-array:', appsData)
        toast.error('Failed to load applications — try refreshing')
        return
      }
      setApps(appsData)
      setClubs(Array.isArray(clubData) ? clubData : [])
      if (settings?.defaultClubId) setDefaultClubId(settings.defaultClubId)
    }).finally(() => setLoading(false))
  }

  useEffect(() => {
    loadApps()
    const onFocus = () => loadApps()
    window.addEventListener('focus', onFocus)
    const interval = setInterval(() => {
      // Don't disrupt an open review panel
      if (document.hidden) return
      fetch('/app/api/admin/applications', { credentials: 'include', cache: 'no-store' })
        .then(r => r.json())
        .then(data => { if (Array.isArray(data)) setApps(data) })
        .catch(() => {})
    }, 30_000)
    return () => { window.removeEventListener('focus', onFocus); clearInterval(interval) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function open(app: Application) {
    setSelected(app)
    setReviewNote(app.reviewNote ?? '')
    setRejectMsg('')
    setAssignedClubs(defaultClubId ? [defaultClubId] : [])
    setAiResult(null)
    setWelcomeMsg('')
  }

  async function draftWelcome(id: string) {
    setWelcomeLoading(true)
    try {
      const res = await fetch('/app/api/admin/applications/welcome', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.ok) {
        const { message } = await res.json()
        setWelcomeMsg(message)
      } else {
        toast.error('Failed to generate welcome message')
      }
    } finally {
      setWelcomeLoading(false)
    }
  }

  async function screenWithAI(id: string) {
    setAiLoading(true)
    try {
      const res = await fetch('/app/api/admin/applications/screen', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.ok) setAiResult(await res.json())
      else toast.error('AI screening failed')
    } finally {
      setAiLoading(false)
    }
  }

  async function decide(id: string, status: 'approved' | 'rejected') {
    setSaving(true)
    const res = await fetch('/app/api/admin/applications', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, reviewNote, assignedClubs: status === 'approved' ? assignedClubs : [], rejectionMessage: rejectMsg, welcomeMessage: status === 'approved' && welcomeMsg ? welcomeMsg : undefined }),
    })
    if (res.ok) {
      setApps(prev => prev.map(a => a.id === id ? { ...a, status, reviewNote } : a))
      setSelected(null)
      toast.success(status === 'approved' ? 'Approved ✓' : 'Rejected')
    } else {
      const d = await res.json().catch(() => ({}))
      toast.error(d.error ?? 'Failed to update application')
    }
    setSaving(false)
  }

  async function suggest(id: string, suggestion: 'approve' | 'reject' | null) {
    const res = await fetch('/app/api/admin/applications', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, suggestion, reviewNote }),
    })
    if (res.ok) {
      setApps(prev => prev.map(a => a.id === id ? { ...a, suggestion, reviewNote } : a))
      toast(suggestion ? `Suggested: ${suggestion}` : 'Suggestion cleared')
    }
  }

  async function saveNote() {
    if (!selected) return
    const res = await fetch('/app/api/admin/applications', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selected.id, reviewNote }),
    })
    if (res.ok) { setApps(prev => prev.map(a => a.id === selected.id ? { ...a, reviewNote } : a)); toast('Note saved') }
  }

  // Quick decide — inline approve/reject without opening the modal. Sends
  // the standard activation/rejection email but skips the personalized
  // welcome / rejection message that the modal would let you write. The
  // toast and (for reject) confirm dialog make the "no personal note"
  // consequence explicit so admins don't accidentally silent-reject.
  async function quickDecide(e: React.MouseEvent, id: string, status: 'approved' | 'rejected') {
    e.stopPropagation()
    if (status === 'rejected') {
      const app = apps.find(a => a.id === id)
      const name = app?.fullName ?? 'this applicant'
      if (!confirm(`Reject ${name} without a personalized message?\n\nThe standard rejection email will still go out — but they won't get any context. Open the review modal if you want to add a note.`)) return
    }
    const res = await fetch('/app/api/admin/applications', {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, reviewNote: '', assignedClubs: status === 'approved' && defaultClubId ? [defaultClubId] : [] }),
    })
    if (res.ok) {
      setApps(prev => prev.map(a => a.id === id ? { ...a, status } : a))
      toast.success(status === 'approved'
        ? 'Approved · standard welcome email sent (no personal note)'
        : 'Rejected · standard email sent (no personal note)')
    }
  }

  async function bulkAction(status: 'approved' | 'rejected') {
    if (!selected2.size) return
    setBulkSaving(true)
    const ids = [...selected2]
    await Promise.all(ids.map(id =>
      fetch('/app/api/admin/applications', {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status, reviewNote: '', assignedClubs: status === 'approved' && defaultClubId ? [defaultClubId] : [] }),
      })
    ))
    setApps(prev => prev.map(a => ids.includes(a.id) ? { ...a, status } : a))
    setSelected2(new Set())
    setBulkSaving(false)
    toast(`${ids.length} ${status}`)
  }

  const counts = {
    pending:  apps.filter(a => a.status === 'pending').length,
    approved: apps.filter(a => a.status === 'approved').length,
    rejected: apps.filter(a => a.status === 'rejected').length,
  }

  // Pipeline numbers for the header — computed from the apps array that's
  // already loaded. Approval rate is approved / (approved + rejected) so
  // pending applications don't drag it down before they're decided.
  const decidedCount = counts.approved + counts.rejected
  const pipeline = {
    total:        apps.length,
    approvalRate: decidedCount > 0 ? Math.round((counts.approved / decidedCount) * 100) : null,
  }

  const visible = apps
    .filter(a => a.status === tab)
    .filter(a => !filterInterest     || a.interests?.includes(filterInterest))
    .filter(a => !filterContribution || a.contribution === filterContribution)
    .sort((a, b) => sortBy === 'score'
      ? score(b) - score(a)
      : new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )

  return (
    <div className="p-4 sm:p-6 space-y-5">


      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Applications</h1>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-sm text-zinc-500">
              <span className="text-white font-bold">{pipeline.total}</span> total
            </span>
            {pipeline.approvalRate !== null && (
              <span className="flex items-center gap-1.5 text-xs text-zinc-500">
                <span className="w-16 h-1 bg-zinc-700 rounded-full overflow-hidden inline-block align-middle">
                  <span className="h-full bg-green-500 rounded-full block" style={{ width: `${pipeline.approvalRate}%` }} />
                </span>
                <span className="text-green-400 font-semibold">{pipeline.approvalRate}%</span> approval
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadApps} disabled={loading}
            className="text-xs px-3 py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors disabled:opacity-40">
            {loading ? '…' : '↻ Refresh'}
          </button>
          <Link href="/apply" target="_blank"
            className="text-xs px-3 py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors">
            View form →
          </Link>
        </div>
      </div>

      {/* Tabs + filters in one row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-zinc-800 rounded-xl p-1">
          {(['pending', 'approved', 'rejected'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                tab === t ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'
              }`}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                tab === t ? 'bg-zinc-600 text-zinc-300' : 'bg-zinc-700 text-zinc-500'
              }`}>{counts[t]}</span>
            </button>
          ))}
        </div>

        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="px-3 py-1.5 rounded-xl border border-zinc-700 text-xs text-zinc-300 bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-amber-500">
          <option value="recent">Newest first</option>
          <option value="score">Best fit first</option>
        </select>

        <select value={filterInterest} onChange={e => setFilterInterest(e.target.value)}
          className="px-3 py-1.5 rounded-xl border border-zinc-700 text-xs text-zinc-300 bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-amber-500">
          <option value="">All interests</option>
          {INTERESTS.map(i => <option key={i} value={i}>{i.charAt(0).toUpperCase() + i.slice(1)}</option>)}
        </select>

        {/* Contribution filter — wires up the ?contribution=host URL param
            from the analytics host-pipeline link. Drops the dead-link bug
            and gives admins a single dropdown to find host candidates. */}
        <select value={filterContribution} onChange={e => setFilterContribution(e.target.value)}
          className="px-3 py-1.5 rounded-xl border border-zinc-700 text-xs text-zinc-300 bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-amber-500">
          <option value="">Any contribution</option>
          <option value="host">🎖️ Wants to host</option>
          <option value="organize">🤝 Help organize</option>
          <option value="attend">🎟️ Attend only</option>
        </select>

        {(filterInterest || filterContribution) && (
          <button onClick={() => { setFilterInterest(''); setFilterContribution('') }}
            className="text-xs text-zinc-500 hover:text-white">✕ Clear filters</button>
        )}
      </div>

      {/* Bulk bar */}
      {(selected2.size > 0 || visible.length > 0) && tab === 'pending' && (
        <div className="flex items-center gap-3 px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl">
          <input
            type="checkbox"
            checked={selected2.size === visible.length && visible.length > 0}
            onChange={() => setSelected2(selected2.size === visible.length ? new Set() : new Set(visible.map(a => a.id)))}
            className="w-4 h-4 rounded accent-amber-500 shrink-0"
          />
          <span className="text-sm text-zinc-400">
            {selected2.size > 0 ? <span className="font-semibold text-white">{selected2.size} selected</span> : `Select all ${visible.length}`}
          </span>
          {selected2.size > 0 && (
            <div className="flex gap-2 ml-auto">
              <button onClick={() => bulkAction('approved')} disabled={bulkSaving}
                className="px-4 py-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-bold rounded-lg disabled:opacity-50">
                {bulkSaving ? '…' : `✅ Approve ${selected2.size}`}
              </button>
              <button onClick={() => bulkAction('rejected')} disabled={bulkSaving}
                className="px-4 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded-lg disabled:opacity-50">
                {bulkSaving ? '…' : `❌ Reject ${selected2.size}`}
              </button>
              <button onClick={() => setSelected2(new Set())} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-white">Cancel</button>
            </div>
          )}
        </div>
      )}

      {/* Default club */}
      {clubs.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>Auto-assign on approval:</span>
          <select value={defaultClubId}
            onChange={async e => {
              const val = e.target.value
              setDefaultClubId(val)
              const res = await fetch('/app/api/admin/settings', {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ defaultClubId: val }),
              })
              if (res.ok) toast.success(val ? `Default club saved ✓` : 'Default club cleared')
            }}
            className="px-2 py-1 rounded-lg border border-zinc-700 text-xs text-zinc-300 bg-zinc-800 focus:outline-none">
            <option value="">No default club</option>
            {clubs.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
          </select>
        </div>
      )}

      {/* List */}
      <div className="space-y-2">
        {loading && <div className="py-12 text-center text-zinc-500 text-sm">Loading…</div>}
        {!loading && visible.length === 0 && (
          <div className="py-16 text-center">
            <div className="text-3xl mb-2">{tab === 'pending' ? '🎉' : tab === 'approved' ? '✅' : '📭'}</div>
            <p className="text-zinc-500 text-sm">No {tab} applications.</p>
          </div>
        )}
        {visible.map(app => (
          <div key={app.id}
            className={`bg-zinc-900 rounded-2xl border transition-colors cursor-pointer ${selected2.has(app.id) ? 'border-amber-500/50' : 'border-zinc-800 hover:border-zinc-700'}`}
            onClick={() => open(app)}
          >
            <div className="flex items-center gap-4 p-4">
              {/* Checkbox */}
              <input type="checkbox" checked={selected2.has(app.id)}
                onClick={e => e.stopPropagation()}
                onChange={() => setSelected2(prev => { const s = new Set(prev); s.has(app.id) ? s.delete(app.id) : s.add(app.id); return s })}
                className="w-4 h-4 rounded accent-amber-500 shrink-0" />

              {/* Avatar */}
              {app.profilePhoto
                ? <img src={resolveImageUrl(app.profilePhoto)} alt={app.fullName} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                : <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center text-xl shrink-0">👤</div>
              }

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-white text-sm">{app.fullName}</span>
                  {app.profession && <span className="text-xs text-zinc-500">{app.profession}</span>}
                  {app.country && <span className="text-xs text-zinc-600">· {app.country}</span>}
                </div>
                {(app.aboutCommunity || app.whyJoin || app.bio) && (
                  <p className="text-xs text-zinc-500 mt-0.5 truncate">
                    {(app.aboutCommunity || app.whyJoin || app.bio)?.slice(0, 100)}
                  </p>
                )}
                <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                  <Score app={app} />
                  <Flag app={app} />
                  {app.fingerprint && apps.some(a => a.id !== app.id && a.fingerprint === app.fingerprint && a.status !== 'approved') && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">⚠️ Same device</span>
                  )}
                  {app.ipAddress && apps.some(a => a.id !== app.id && a.ipAddress === app.ipAddress && a.status !== 'approved') && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400">⚠️ IP reused</span>
                  )}
                  {app.timezoneMismatch && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400">⚠️ VPN?</span>
                  )}
                  {app.disposableEmail && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400">⚠️ Temp email</span>
                  )}
                  {app.referredBy && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">
                      🔗 Referred
                    </span>
                  )}
                  {app.suggestion && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${app.suggestion === 'approve' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                      Mod: {app.suggestion}
                    </span>
                  )}
                  {app.contribution && app.contribution !== 'attend' && (
                    <span className="text-xs text-amber-400">{CONTRIBUTION_LABEL[app.contribution]}</span>
                  )}
                  <span className="text-xs text-zinc-700 ml-auto">
                    {new Date(app.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              </div>

              {/* Actions */}
              {app.status === 'pending' ? (
                <div className="flex gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                  <button onClick={e => quickDecide(e, app.id, 'approved')}
                    className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-bold rounded-lg transition-colors">
                    ✓ Approve
                  </button>
                  <button onClick={e => quickDecide(e, app.id, 'rejected')}
                    className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold rounded-lg transition-colors">
                    ✕ Reject
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full border capitalize ${STATUS[app.status]}`}>
                    {app.status}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Review modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setSelected(null)}>
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto flex flex-col" onClick={e => e.stopPropagation()}>

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Score app={selected} />
                <Flag app={selected} />
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full border capitalize ${STATUS[selected.status]}`}>{selected.status}</span>
                {selected.suggestion && !isMod && (
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${selected.suggestion === 'approve' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                    Mod suggests: {selected.suggestion}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {selected.status === 'pending' && !isMod && (
                  <div className="flex gap-1.5 md:hidden">
                    <button onClick={() => decide(selected.id, 'approved')} disabled={saving}
                      className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-bold rounded-lg disabled:opacity-50">
                      {saving ? '…' : '✓'}
                    </button>
                    <button onClick={() => decide(selected.id, 'rejected')} disabled={saving}
                      className="px-3 py-1.5 bg-red-500/10 text-red-400 text-xs font-bold rounded-lg disabled:opacity-50">
                      {saving ? '…' : '✕'}
                    </button>
                  </div>
                )}
                <button onClick={() => screenWithAI(selected.id)} disabled={aiLoading}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 transition-colors disabled:opacity-50">
                  <span className="hidden sm:inline">{aiLoading ? '⏳ Screening…' : aiResult ? '✦ Re-screen' : '✦ AI Screen'}</span>
                  <span className="sm:hidden">{aiLoading ? '⏳' : '✦'}</span>
                </button>
                <button onClick={() => setSelected(null)} className="text-zinc-500 hover:text-white text-xl leading-none">×</button>
              </div>
            </div>

            {/* Modal body */}
            <div className="flex flex-col md:flex-row md:flex-1 md:overflow-hidden">

              {/* Left — identity */}
              <div className="md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-zinc-800 md:overflow-y-auto p-5 space-y-4">
                <div className="flex flex-col items-center text-center">
                  {selected.profilePhoto
                    ? <img src={resolveImageUrl(selected.profilePhoto)} alt={selected.fullName} className="w-24 h-24 rounded-xl object-cover" />
                    : <div className="w-24 h-24 rounded-xl bg-zinc-800 flex items-center justify-center text-4xl">👤</div>
                  }
                  <h2 className="font-bold text-white mt-3">{selected.fullName}</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {[selected.birthdate && new Date(selected.birthdate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }), selected.gender?.replace('_', ' '), selected.country, selected.city].filter(Boolean).join(' · ')}
                  </p>
                  {selected.profession && <p className="text-xs text-zinc-400 mt-1">{selected.profession}</p>}
                </div>

                <div className="space-y-1 text-xs">
                  <div className="flex gap-2"><span className="text-zinc-600 w-12 shrink-0">Email</span><span className="text-zinc-400 truncate">{selected.email}</span></div>
                  {selected.phone  && <div className="flex gap-2"><span className="text-zinc-600 w-12 shrink-0">Phone</span><span className="text-zinc-400">{selected.phone}</span></div>}
                  {selected.source && <div className="flex gap-2"><span className="text-zinc-600 w-12 shrink-0">Via</span><span className="text-zinc-400 capitalize">{selected.source}</span></div>}
                  {selected.referredBy && <div className="flex gap-2"><span className="text-zinc-600 w-24 shrink-0">Referral code</span><span className="text-amber-400 font-mono text-xs">{selected.referredBy}</span></div>}
                  {selected.ipAddress && (
                    <div className="flex gap-2 items-center">
                      <span className="text-zinc-600 w-12 shrink-0">IP</span>
                      <span className="text-zinc-300 font-mono text-xs">{selected.ipAddress}</span>
                      {apps.filter(a => a.id !== selected.id && a.ipAddress === selected.ipAddress && a.status !== 'approved').length > 0 && (
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">⚠️ IP reused</span>
                      )}
                    </div>
                  )}
                  {selected.userAgent && <div className="flex gap-2"><span className="text-zinc-600 w-12 shrink-0">Device</span><span className="text-zinc-500 text-xs truncate">{selected.userAgent}</span></div>}
                  {selected.fingerprint && (
                    <div className="flex gap-2 items-center">
                      <span className="text-zinc-600 w-20 shrink-0">Fingerprint</span>
                      <span className="text-zinc-400 font-mono text-xs">{selected.fingerprint.slice(0, 16)}…</span>
                      {apps.filter(a => a.id !== selected.id && a.fingerprint && a.fingerprint === selected.fingerprint && a.status !== 'approved').length > 0 && (
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">⚠️ Same device</span>
                      )}
                    </div>
                  )}
                  {selected.timezone && (
                    <div className="flex gap-2 items-center">
                      <span className="text-zinc-600 w-20 shrink-0">Timezone</span>
                      <span className="text-zinc-400 text-xs">{selected.timezone}</span>
                      {selected.timezoneMismatch && (
                        <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">⚠️ IP mismatch — possible VPN</span>
                      )}
                    </div>
                  )}
                  {selected.disposableEmail && (
                    <div className="flex gap-2 items-center">
                      <span className="text-zinc-600 w-20 shrink-0">Email type</span>
                      <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">⚠️ Disposable / temp email</span>
                    </div>
                  )}
                </div>

                {(selected.instagram || selected.linkedin) && (
                  <div className="space-y-1">
                    {selected.instagram && (
                      <a href={`https://instagram.com/${selected.instagram.replace('@','')}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-pink-400 hover:underline">
                        📸 {selected.instagram}
                      </a>
                    )}
                    {selected.linkedin && (
                      <a href={selected.linkedin.startsWith('http') ? selected.linkedin : `https://${selected.linkedin}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs text-blue-400 hover:underline truncate">
                        💼 LinkedIn
                      </a>
                    )}
                  </div>
                )}

                {selected.interests?.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-zinc-600 uppercase tracking-wider mb-1.5">Interests</p>
                    <div className="flex flex-wrap gap-1">
                      {selected.interests.map(i => (
                        <span key={i} className="px-2 py-0.5 bg-amber-500/10 text-amber-400 rounded-full text-xs font-semibold capitalize">{i}</span>
                      ))}
                    </div>
                  </div>
                )}

                {selected.contribution && (
                  <div>
                    <p className="text-xs font-bold text-zinc-600 uppercase tracking-wider mb-1.5">Plans to</p>
                    <span className="text-xs text-amber-400">{CONTRIBUTION_LABEL[selected.contribution] ?? selected.contribution}</span>
                  </div>
                )}
              </div>

              {/* Right — answers + decision */}
              <div className="flex-1 flex flex-col md:overflow-hidden">
                <div className="md:flex-1 md:overflow-y-auto p-5 space-y-4">

                  {/* AI screening result */}
                  {aiResult && (() => {
                    const rec = aiResult.recommendation
                    const colors = rec === 'approve'
                      ? { bg: 'bg-green-500/10', border: 'border-green-500/20', badge: 'bg-green-500/20 text-green-400', dot: 'text-green-400' }
                      : rec === 'reject'
                      ? { bg: 'bg-red-500/10',   border: 'border-red-500/20',   badge: 'bg-red-500/20 text-red-400',     dot: 'text-red-400'   }
                      : { bg: 'bg-amber-500/10', border: 'border-amber-500/20', badge: 'bg-amber-500/20 text-amber-400', dot: 'text-amber-400' }
                    return (
                      <div className={`rounded-xl border p-4 space-y-3 ${colors.bg} ${colors.border}`}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">AI Screening</span>
                          <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full capitalize ${colors.badge}`}>
                            {rec === 'approve' ? '✓ Approve' : rec === 'reject' ? '✕ Reject' : '~ Review'}
                          </span>
                          <span className="text-xs text-zinc-500">{aiResult.confidence}% confidence</span>
                        </div>
                        <p className="text-xs text-zinc-300 leading-relaxed">{aiResult.summary}</p>
                        {aiResult.strengths.length > 0 && (
                          <div>
                            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">Strengths</p>
                            <ul className="space-y-0.5">
                              {aiResult.strengths.map((s, i) => (
                                <li key={i} className="flex items-start gap-1.5 text-xs text-zinc-300">
                                  <span className="text-green-400 shrink-0 mt-0.5">●</span>{s}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {aiResult.redFlags.length > 0 && (
                          <div>
                            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">Red flags</p>
                            <ul className="space-y-0.5">
                              {aiResult.redFlags.map((f, i) => (
                                <li key={i} className="flex items-start gap-1.5 text-xs text-zinc-300">
                                  <span className="text-red-400 shrink-0 mt-0.5">●</span>{f}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {aiResult.suggestedQuestions.length > 0 && (
                          <div>
                            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">Suggested follow-up questions</p>
                            <ul className="space-y-0.5">
                              {aiResult.suggestedQuestions.map((q, i) => (
                                <li key={i} className="flex items-start gap-1.5 text-xs text-zinc-300">
                                  <span className="text-violet-400 shrink-0 mt-0.5">?</span>{q}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  {/* Key answers */}
                  {selected.aboutCommunity && (
                    <div className="bg-zinc-800/40 border border-zinc-700 rounded-xl p-3 mb-3">
                      <QA q="Community they're looking for + what they'd bring" a={selected.aboutCommunity} />
                    </div>
                  )}
                  {(selected.whyJoin || selected.goodCommunity || selected.enjoyWith) && (
                    <div className="space-y-3">
                      <QA q="Why join Smileys?" a={selected.whyJoin} />
                      <QA q="What makes a great community?" a={selected.goodCommunity} />
                      <QA q="Enjoys spending time with" a={selected.enjoyWith} />
                    </div>
                  )}

                  {/* Background */}
                  {(selected.reasonHere || selected.timeInCity || selected.bio) && (
                    <div className="border-t border-zinc-800 pt-4 space-y-3">
                      <QA q="Reason in Istanbul" a={selected.reasonHere} />
                      <QA q="Time in city" a={selected.timeInCity} />
                      <QA q="Bio / notes" a={selected.bio} />
                    </div>
                  )}

                  {/* Social behavior */}
                  {selected.socialJudgment && (
                    <div className="bg-zinc-800/40 border border-zinc-700 rounded-xl p-3 mb-3">
                      <QA q="Handled a difficult social situation" a={selected.socialJudgment} />
                    </div>
                  )}
                  {(selected.groupBehavior || selected.removedFromCommunity || selected.toxicBehavior) && (
                    <div className="border-t border-zinc-800 pt-4 space-y-3">
                      <QA q="In group settings" a={selected.groupBehavior} />
                      {selected.removedFromCommunity && selected.removedFromCommunity.toLowerCase() !== 'no' && (
                        <QA q="⚠️ Removed from community?" a={selected.removedFromCommunity} />
                      )}
                      <QA q="Handles toxic behavior by" a={selected.toxicBehavior} />
                    </div>
                  )}

                  {/* Assign clubs (pending only) */}
                  {selected.status === 'pending' && clubs.length > 0 && (
                    <div className="border-t border-zinc-800 pt-4">
                      <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Assign to clubs on approval</p>
                      <div className="flex flex-wrap gap-1.5">
                        {clubs.map(c => {
                          const active = assignedClubs.includes(c.id)
                          return (
                            <button key={c.id} type="button"
                              onClick={() => setAssignedClubs(prev => prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id])}
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                                active ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 'border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300'
                              }`}
                            >
                              {c.emoji} {c.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Decision panel */}
                <div className="shrink-0 border-t border-zinc-800 p-4 space-y-3 bg-zinc-900/80">
                  <div className="flex gap-2">
                    <input value={reviewNote} onChange={e => setReviewNote(e.target.value)}
                      placeholder="Internal note (only visible to admins)…"
                      className="flex-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-amber-500 text-white placeholder-zinc-600" />
                    <button onClick={saveNote} className="px-3 py-2 text-xs text-zinc-400 border border-zinc-700 rounded-xl hover:bg-zinc-800 transition-colors">
                      Save
                    </button>
                  </div>

                  {isMod ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => suggest(selected.id, selected.suggestion === 'approve' ? null : 'approve')}
                          className={`py-2.5 font-bold rounded-xl text-sm transition-colors ${selected.suggestion === 'approve' ? 'bg-green-500 text-white' : 'bg-green-500/10 hover:bg-green-500/20 text-green-400'}`}>
                          👍 {selected.suggestion === 'approve' ? 'Suggested approve ✓' : 'Suggest approve'}
                        </button>
                        <button onClick={() => suggest(selected.id, selected.suggestion === 'reject' ? null : 'reject')}
                          className={`py-2.5 font-bold rounded-xl text-sm transition-colors ${selected.suggestion === 'reject' ? 'bg-red-500 text-white' : 'bg-red-500/10 hover:bg-red-500/20 text-red-400'}`}>
                          👎 {selected.suggestion === 'reject' ? 'Suggested reject ✓' : 'Suggest reject'}
                        </button>
                      </div>
                    </div>
                  ) : selected.status === 'pending' ? (
                    <div className="space-y-2">
                      {/* Welcome message draft */}
                      <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Welcome message</p>
                          <button onClick={() => draftWelcome(selected.id)} disabled={welcomeLoading}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 transition-colors disabled:opacity-50">
                            {welcomeLoading ? '⏳ Writing…' : welcomeMsg ? '✦ Redraft' : '✦ Draft with AI'}
                          </button>
                        </div>
                        <textarea
                          value={welcomeMsg}
                          onChange={e => setWelcomeMsg(e.target.value)}
                          rows={3}
                          placeholder="AI will draft a personalised welcome — or write your own…"
                          className="w-full px-3 py-2 text-xs bg-zinc-900 border border-zinc-700 rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500/50 resize-none"
                        />
                        {welcomeMsg && <p className="text-xs text-zinc-600">Sent to the member on approval. Edit before approving.</p>}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => decide(selected.id, 'approved')} disabled={saving}
                          className="py-2.5 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-50">
                          {saving ? '…' : '✅ Approve'}
                        </button>
                        <button onClick={() => decide(selected.id, 'rejected')} disabled={saving}
                          className="py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold rounded-xl text-sm transition-colors disabled:opacity-50">
                          {saving ? '…' : '❌ Reject'}
                        </button>
                      </div>
                      {(selected.fingerprint || selected.ipAddress) && (
                        <button
                          onClick={async () => {
                            if (!confirm('Blacklist this device/IP? Future applications from same device will be auto-rejected.')) return
                            await fetch('/app/api/admin/blacklist', {
                              method: 'POST', credentials: 'include',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                name: selected.fullName,
                                fingerprint: selected.fingerprint || undefined,
                                ipAddress: selected.ipAddress || undefined,
                                reason: `Blacklisted device/IP from application by ${selected.fullName} (${selected.email})`,
                              }),
                            })
                            toast.success('Device blacklisted — future attempts auto-rejected')
                          }}
                          className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-red-400 font-semibold rounded-xl text-xs transition-colors border border-zinc-700">
                          🚫 Blacklist this device / IP
                        </button>
                      )}
                      <textarea value={rejectMsg} onChange={e => setRejectMsg(e.target.value)} rows={2}
                        placeholder="Optional message to applicant on rejection…"
                        className="w-full px-3 py-2 text-xs bg-zinc-800 border border-zinc-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-red-500/50 text-white placeholder-zinc-600 resize-none" />
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-semibold px-3 py-1.5 rounded-full border capitalize ${STATUS[selected.status]}`}>{selected.status}</span>
                      <button onClick={() => decide(selected.id, selected.status === 'approved' ? 'rejected' : 'approved')} disabled={saving}
                        className="text-xs px-3 py-2 rounded-lg border border-zinc-700 text-zinc-400 hover:bg-zinc-800 transition-colors disabled:opacity-50">
                        Change to {selected.status === 'approved' ? 'rejected' : 'approved'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
