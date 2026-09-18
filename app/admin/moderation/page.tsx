'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { toastApiError } from '@/lib/apiError'
import { confirmToast } from '@/lib/confirmToast'
import { useAuth } from '@/contexts/AuthContext'
import Avatar from '@/components/admin/Avatar'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { DEFAULT_CURRENCY, formatMoney, currencySymbol } from '@/lib/data'
import { phonePlaceholder, dialCode } from '@/lib/country'
import { formatDay } from '@/lib/cityTime'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { loadFailure } from '@/lib/admin/useAdminLoad'
import { notifyModerationChanged } from '@/lib/modCounts'

interface Report {
  id: string
  reason: string
  details: string | null
  status: string
  reviewNote: string | null
  createdAt: string
  escalated?: boolean
  escalatedNote?: string | null
  reporter: { id: string; name: string; email: string; color: string }
  reported: { id: string; name: string; email: string; color: string; status: string; role: string }
  // Members who have blocked the reported user. A silent corroborating
  // signal — people block far more readily than they report.
  reportedBlockCount?: number
  event?: { id: string; title: string } | null
  boardPost?: { id: string; title: string; body: string; status: string } | null
  boardReply?: { id: string; body: string; removed: boolean } | null
  listing?: { id: string; title: string; category: string; status: string } | null
  neighborhoodPost?: { id: string; content: string; neighborhood: string; slug: string } | null
}

interface BannedUser {
  id: string; name: string; email: string; color: string
  banReason: string | null; bannedAt: string | null; role: string
  appealNote: string | null; appealStatus: string | null; appealedAt: string | null
}

interface BlacklistEntry {
  id: string; email: string | null; phone: string | null
  name: string | null; reason: string; createdAt: string
}

interface EventMessage {
  id: string; message: string; createdAt: string
  user:  { id: string; name: string; email: string; color: string; role: string }
  event: { id: string; title: string }
}

interface QueueEvent {
  id: string; title: string; description: string | null; date: string; time: string
  price: number; currency?: string; totalSpots: number; status: string; createdAt: string
  address: string | null; neighborhood: string | null; coverImage: string | null
  // Both can be missing: clubId is optional on Event, and the approval route
  // answers host: null when the host's account is gone.
  host: { id: string; name: string; email: string; color: string } | null
  club: { id: string; name: string } | null
}

const REASON_LABELS: Record<string, string> = {
  // Canonical reason set — matches VALID_REASONS in app/api/reports/route.ts
  // and components/ReportButton. (Old keys inappropriate_behavior/fake_profile
  // were never storable — the old API rejected them — so dropping them is safe.)
  harassment:        'Harassment',
  inappropriate:     'Inappropriate behavior',
  fake:              'Fake profile',
  spam:              'Spam',
  offensive:         'Offensive content',
  no_show:           'Repeated no-shows',
  other:             'Other',
  // Reports auto-created by the post-event safety survey when a
  // respondent flagged "anything off?" — the details field carries
  // the verbatim free-text the respondent left.
  post_event_survey:      '✿ From post-event survey',
}

const STATUS_COLORS: Record<string, string> = {
  pending:   'bg-amber-500/10 text-amber-400',
  actioned:  'bg-green-500/10 text-green-400',
  dismissed: 'bg-zinc-700 text-zinc-400',
}

const EVENT_STATUS_COLORS: Record<string, string> = {
  published:   'bg-green-500/10 text-green-400',
  flagged:     'bg-red-500/10 text-red-400',
  unpublished: 'bg-zinc-700 text-zinc-400',
}

type TabKey = 'reports' | 'messages' | 'events' | 'banned' | 'blacklist'
type StatusFilter = 'all' | 'pending' | 'actioned' | 'dismissed'

const TAB_KEYS: TabKey[] = ['reports', 'messages', 'events', 'banned', 'blacklist']
const STATUS_KEYS: StatusFilter[] = ['all', 'pending', 'actioned', 'dismissed']

export default function ModerationPage() {
  return <Suspense><ModerationPageInner /></Suspense>
}

function ModerationPageInner() {
  const cur = useCurrentCity()?.currency ?? DEFAULT_CURRENCY
  const country = useCurrentCity()?.country
  const { user, isLoading: authLoading } = useAuth()
  const isAdmin = user?.role === 'admin'
  const searchParams = useSearchParams()
  const router       = useRouter()
  const pathname     = usePathname()

  // Read initial tab / status filter from the URL so reload + deep links
  // land on the same view. Whitelist guards against junk query strings.
  const initialTab = (TAB_KEYS as readonly string[]).includes(searchParams.get('tab') ?? '')
    ? (searchParams.get('tab') as TabKey) : 'reports'
  const initialStatus = (STATUS_KEYS as readonly string[]).includes(searchParams.get('status') ?? '')
    ? (searchParams.get('status') as StatusFilter) : 'all'

  const [tab, setTab] = useState<TabKey>(initialTab)
  const [reports,   setReports]   = useState<Report[]>([])
  const [banned,    setBanned]    = useState<BannedUser[]>([])
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([])
  const [messages,  setMessages]  = useState<EventMessage[]>([])
  const [queue,     setQueue]     = useState<QueueEvent[]>([])
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus)
  // "From surveys" pill — filters to reports auto-created by the
  // post-event survey when an attendee flagged something off. These
  // come with the verbatim anomalyNote in `details` and need to be
  // triaged differently from member-filed reports (the reporter is
  // anonymous to the host; the host is the responsible party but
  // not necessarily the offender).
  // URL-initialised so /admin/feedback's "⚠ N flags →" pill can deep-
  // link straight into the filtered Reports view via `?surveyOnly=1`.
  const [surveyOnly, setSurveyOnly] = useState(searchParams.get('surveyOnly') === '1')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [, setTick] = useState(0)  // 1s tick so the "Updated Xs ago" label ages

  // Review modal
  const [selected,   setSelected]   = useState<Report | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [banReason,  setBanReason]  = useState('')
  const [removeContent, setRemoveContent] = useState(true)
  const [saving,     setSaving]     = useState(false)

  // Blacklist form
  const [blEmail,  setBlEmail]  = useState('')
  const [blPhone,  setBlPhone]  = useState('')
  const [blName,   setBlName]   = useState('')
  const [blReason, setBlReason] = useState('')
  const [blSaving, setBlSaving] = useState(false)

  // AI triage
  const [triageResults, setTriageResults] = useState<Record<string, { recommendation: string; confidence: number; reasoning: string }>>({})
  const [triageLoading, setTriageLoading] = useState<string | null>(null)

  // One search box adapts to whichever tab is active — fields differ per
  // tab but a single piece of state keeps the UI quiet. Reset on tab
  // switch so a Reports query doesn't bleed into the Messages list.
  const [search, setSearch] = useState('')
  useEffect(() => { setSearch('') }, [tab])

  // Bulk-selection state for the Messages tab. Same pattern as
  // /admin/users — bulk-action bar appears once anything is checked.
  const [selectedMsgs, setSelectedMsgs] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  useEffect(() => { setSelectedMsgs(new Set()) }, [tab])

  async function triageReport(reportId: string) {
    setTriageLoading(reportId)
    try {
      const res = await fetch('/app/api/admin/moderation/triage', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId }),
      })
      if (res.ok) {
        const data = await res.json()
        setTriageResults(prev => ({ ...prev, [reportId]: data }))
      } else {
        // Without this the spinner just clears and the moderator has no
        // idea the LLM call failed — they'd click again wondering why
        // nothing happened.
        const d = await res.json().catch(() => ({}))
        toast.error(d.error ?? 'AI triage failed')
      }
    } catch {
      toast.error('AI triage failed')
    } finally {
      setTriageLoading(null)
    }
  }

  // load() runs the initial fetch and the auto-refresh poll. background=true
  // skips the skeleton flicker so the 30s refresh doesn't blank the page.
  const load = useCallback((background = false) => {
    // A refused feed (403, 429, 500) used to parse its error body, fail the
    // Array.isArray check and blank that tab — "No reports" while reports
    // waited. A failed feed now keeps what was on screen and names itself
    // in the retry banner.
    const failed: string[] = []
    const safe = (label: string, p: Promise<Response>) =>
      p.then(async r => { if (!r.ok) throw await loadFailure(r); return r.json() })
        .catch((e) => { console.error('Moderation fetch error:', e); failed.push(`${label}: ${e?.message ?? 'failed'}`); return null })

    if (!background) setLoading(true)
    const all = [
      safe('Reports',     fetch('/app/api/admin/moderation',     { credentials: 'include' })),
      safe('Messages',    fetch('/app/api/admin/messages',        { credentials: 'include' })),
      safe('Event queue', fetch('/app/api/admin/events/approval', { credentials: 'include' })),
      isAdmin ? safe('Banned',    fetch('/app/api/admin/users?status=banned', { credentials: 'include' })) : Promise.resolve(null),
      isAdmin ? safe('Blacklist', fetch('/app/api/admin/blacklist',           { credentials: 'include' })) : Promise.resolve(null),
    ]

    Promise.all(all).then(([r, m, q, b, bl]) => {
      if (r  !== null) setReports(Array.isArray(r) ? r : [])
      if (m  !== null) setMessages(Array.isArray(m) ? m : [])
      if (q  !== null) setQueue(Array.isArray(q) ? q : [])
      if (b  !== null) setBanned(Array.isArray(b)   ? b   : [])
      if (bl !== null) setBlacklist(Array.isArray(bl) ? bl : [])
      setLoadError(failed.length ? failed.join(' · ') : null)
      if (!failed.length) setLastRefresh(new Date())
    }).finally(() => { if (!background) setLoading(false) })
  }, [isAdmin])

  useEffect(() => {
    if (authLoading) return
    load(false)
  }, [authLoading, load])

  // Background auto-refresh every 30s, paused via the Page Visibility API
  // when the tab is hidden (matches the admin users / applications pages)
  // and resumed on focus with an immediate refresh — so a new report that
  // came in while the moderator was elsewhere shows up the moment they
  // come back to the tab.
  useEffect(() => {
    if (authLoading) return
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => { if (!timer) timer = setInterval(() => { if (!document.hidden) load(true) }, 30_000) }
    const stop  = () => { if (timer) { clearInterval(timer); timer = null } }
    const onVisibility = () => { if (document.hidden) stop(); else { load(true); start() } }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [authLoading, load])

  // 1s tick so the "Updated Xs ago" label ages without refetching.
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // URL-sync tab + status filter. Reload + deep links land on the same
  // view. Status only shows in the URL on the Reports tab where it
  // actually applies — the other tabs ignore it.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (tab !== 'reports') params.set('tab', tab); else params.delete('tab')
    if (tab === 'reports' && statusFilter !== 'all') params.set('status', statusFilter); else params.delete('status')
    if (tab === 'reports' && surveyOnly) params.set('surveyOnly', '1'); else params.delete('surveyOnly')
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  // searchParams excluded — including it would re-fire on the URL change
  // we just made and create an infinite loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statusFilter, surveyOnly, pathname, router])

  const refreshLabel = (() => {
    if (!lastRefresh) return ''
    const s = Math.floor((Date.now() - lastRefresh.getTime()) / 1000)
    if (s < 5)     return 'Updated just now'
    if (s < 60)    return `Updated ${s}s ago`
    if (s < 3600)  return `Updated ${Math.floor(s / 60)}m ago`
    return `Updated ${Math.floor(s / 3600)}h ago`
  })()

  // A reported board post or reply still up: staff can take it down with
  // the review (the checkbox) or on its own ("Remove").
  const boardContentLive = !!selected?.boardPost && (selected.boardReply ? !selected.boardReply.removed : selected.boardPost.status === 'active')

  async function handleAction(action: 'dismiss' | 'warn' | 'ban' | 'remove') {
    if (!selected) return
    if (action === 'ban' && !banReason.trim()) return
    setSaving(true)
    try {
      const note = action === 'ban' ? banReason.trim() : reviewNote
      const res = await fetch(`/app/api/admin/moderation/${selected.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewNote: note, removeContent: boardContentLive && removeContent }),
      })
      if (res.ok) {
        const newStatus = action === 'dismiss' ? 'dismissed' : 'actioned'
        const tookDown = boardContentLive && (action === 'remove' || (action !== 'dismiss' && removeContent))
        setReports(prev => prev.map(r => r.id === selected.id
          ? { ...r, status: newStatus, reviewNote: note,
              reported: action === 'ban' ? { ...r.reported, status: 'banned' } : r.reported,
              ...(tookDown && r.boardPost ? r.boardReply
                ? { boardReply: { ...r.boardReply, removed: true } }
                : { boardPost: { ...r.boardPost, status: 'removed' } } : {}) }
          : r
        ))
        if (action === 'ban') {
          setBanned(prev => [...prev, {
            id: selected.reported.id, name: selected.reported.name,
            email: selected.reported.email, color: selected.reported.color,
            banReason: banReason.trim(), bannedAt: new Date().toISOString(),
            // Carry the reported user's actual role through — the old code
            // hardcoded 'member', which silently misrepresented banned mods
            // in the Banned tab until next reload.
            role: selected.reported.role,
            appealNote: null, appealStatus: null, appealedAt: null,
          }])
        }
        setSelected(null)
        setReviewNote('')
        setBanReason('')
        notifyModerationChanged()  // topbar report badge refetches
      } else if (res.status === 409) {
        // Another moderator resolved it first. An error in the still-open
        // modal left the report looking pending until the 30s refresh — close
        // it, reload the list and say what happened.
        setSelected(null)
        setReviewNote('')
        setBanReason('')
        toast.info('Already handled by someone else')
        load(true)
        notifyModerationChanged()  // the badge dropped too
      } else {
        // A failed moderation action used to un-busy the button with no
        // signal — the operator thought the ban/warn landed while the report
        // sat unresolved. Surface the server's reason and keep the modal open.
        const d = await res.json().catch(() => ({}))
        toast.error(d?.error ?? `Couldn't ${action} — try again`)
      }
    } catch {
      toast.error('Network error — nothing was saved')
    } finally {
      setSaving(false)
    }
  }

  // Single source of truth for the PATCH that lifts a ban — used both
  // by the direct Unban button and by the "Approve appeal" path so they
  // can't drift (the old code had two copies of this object literal).
  const UNBAN_PAYLOAD = { status: 'approved', banReason: null, bannedAt: null, appealStatus: 'approved' } as const

  async function patchUser(userId: string, body: object): Promise<boolean> {
    const res = await fetch(`/app/api/admin/users/${userId}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) await toastApiError(res, 'Could not update member')
    return res.ok
  }

  async function handleUnban(userId: string) {
    if (!(await confirmToast('Unban this user?'))) return
    if (await patchUser(userId, UNBAN_PAYLOAD)) {
      setBanned(prev => prev.filter(u => u.id !== userId))
    }
  }

  async function handleAppeal(userId: string, decision: 'approved' | 'rejected') {
    const body = decision === 'approved' ? UNBAN_PAYLOAD : { appealStatus: 'rejected' }
    if (!(await patchUser(userId, body))) return
    if (decision === 'approved') {
      setBanned(prev => prev.filter(u => u.id !== userId))
    } else {
      setBanned(prev => prev.map(u => u.id === userId ? { ...u, appealStatus: 'rejected' } : u))
    }
  }

  async function handleAddBlacklist() {
    if (!blReason) return
    setBlSaving(true)
    try {
      const res = await fetch('/app/api/admin/blacklist', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: blEmail || null, phone: blPhone || null, name: blName || null, reason: blReason }),
      })
      if (res.ok) {
        const data = await res.json()
        setBlacklist(prev => [data, ...prev])
        setBlEmail(''); setBlPhone(''); setBlName(''); setBlReason('')
      } else {
        await toastApiError(res, 'Could not add to blacklist')
      }
    } finally {
      setBlSaving(false)
    }
  }

  async function handleRemoveBlacklist(id: string) {
    const res = await fetch(`/app/api/admin/blacklist/${id}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) { toast.error('Could not remove from blacklist'); return }
    setBlacklist(prev => prev.filter(b => b.id !== id))
    toast.success('Removed from blacklist')
  }

  async function handleDeleteMessage(id: string) {
    if (!(await confirmToast('Delete this message?'))) return
    const res = await fetch(`/app/api/admin/messages/${id}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) { toast.error('Could not delete message'); return }
    setMessages(prev => prev.filter(m => m.id !== id))
  }

  async function handleBulkDeleteMessages() {
    if (selectedMsgs.size === 0) return
    if (!(await confirmToast(`Delete ${selectedMsgs.size} message${selectedMsgs.size > 1 ? 's' : ''}?`))) return
    setBulkDeleting(true)
    // Track which ids actually deleted so a partial failure (e.g. one
    // 500) only removes the rows that really went away. Running in
    // series so the toast counts are accurate and the endpoint isn't
    // hammered in parallel.
    const deleted = new Set<string>()
    let fail = 0
    for (const id of selectedMsgs) {
      try {
        const res = await fetch(`/app/api/admin/messages/${id}`, { method: 'DELETE', credentials: 'include' })
        if (res.ok) deleted.add(id); else fail++
      } catch { fail++ }
    }
    setMessages(prev => prev.filter(m => !deleted.has(m.id)))
    setSelectedMsgs(new Set())
    setBulkDeleting(false)
    if (deleted.size) toast.success(`Deleted ${deleted.size} message${deleted.size > 1 ? 's' : ''}`)
    if (fail)         toast.error(`${fail} delete${fail > 1 ? 's' : ''} failed`)
  }

  // The queue holds pending events only, so a decision takes the event out of
  // it: approve publishes it (and tells the host), reject parks it as flagged
  // — off every public listing, and no longer waiting for anyone.
  async function handleEventDecision(e: QueueEvent, decision: 'approve' | 'reject') {
    if (decision === 'reject' && !(await confirmToast(`Reject "${e.title}"? It stays off the public listings.`))) return
    const status = decision === 'approve' ? 'published' : 'flagged'
    const res = await fetch(`/app/api/admin/events/${e.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (res.ok) {
      setQueue(prev => prev.filter(q => q.id !== e.id))
      toast.success(decision === 'approve' ? `"${e.title}" published` : `"${e.title}" rejected`)
      notifyModerationChanged()
    }
    else await toastApiError(res, 'Could not update event')
  }

  // Esc closes the Review modal — only listens while the modal is open
  // and cleans up immediately on close so we don't accumulate handlers.
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected])

  // Per-tab search predicates. One shared input, each tab decides which
  // of its row fields to match against. Case-insensitive substring; empty
  // search short-circuits to "everything".
  const s = search.trim().toLowerCase()
  const matchReport   = (r: Report)        => !s || r.reporter.name.toLowerCase().includes(s) || r.reported.name.toLowerCase().includes(s) || r.reason.toLowerCase().includes(s) || (r.details?.toLowerCase().includes(s) ?? false)
  const matchMessage  = (m: EventMessage)  => !s || m.user.name.toLowerCase().includes(s) || m.message.toLowerCase().includes(s) || m.event.title.toLowerCase().includes(s)
  const matchQueue    = (e: QueueEvent)    => !s || e.title.toLowerCase().includes(s) || (e.host?.name.toLowerCase().includes(s) ?? false) || (e.club?.name.toLowerCase().includes(s) ?? false)
  const matchBanned   = (u: BannedUser)    => !s || u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s) || (u.banReason?.toLowerCase().includes(s) ?? false)
  const matchBlEntry  = (b: BlacklistEntry)=> !s || (b.email?.toLowerCase().includes(s) ?? false) || (b.phone?.toLowerCase().includes(s) ?? false) || (b.name?.toLowerCase().includes(s) ?? false) || b.reason.toLowerCase().includes(s)

  const pendingCount = reports.filter(r => r.status === 'pending').length
  const surveyReportCount = reports.filter(r => r.reason === 'post_event_survey' && r.status === 'pending').length
  const visibleReports   = reports.filter(r =>
    (statusFilter === 'all' || r.status === statusFilter)
    && (!surveyOnly || r.reason === 'post_event_survey')
    && matchReport(r)
  )
  const visibleMessages  = messages.filter(matchMessage)
  const visibleQueue     = queue.filter(matchQueue)
  const visibleBanned    = banned.filter(matchBanned)
  const visibleBlacklist = blacklist.filter(matchBlEntry)
  const allVisibleMsgsSelected = visibleMessages.length > 0 && visibleMessages.every(m => selectedMsgs.has(m.id))

  const inputCls = 'w-full px-3 py-2 text-sm border border-zinc-700 rounded-xl bg-zinc-800 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500'

  const allTabs = [
    { key: 'reports',  label: 'Reports',      badge: pendingCount, adminOnly: false },
    // No badge on Messages — the count is just the 200-message rolling
    // window the API returns, not "items needing attention". Surfacing
    // it as a badge implied actionable work and made the tab look noisy.
    { key: 'messages', label: 'Messages',     badge: 0, adminOnly: false },
    // Everything in the queue is pending review, so the badge is its length.
    // It used to count the queue's published events — the ones needing
    // nothing.
    { key: 'events',   label: 'Event Queue',  badge: queue.length, adminOnly: false },
    { key: 'banned',   label: 'Banned',       badge: banned.length, adminOnly: true },
    { key: 'blacklist',label: 'Blacklist',    badge: blacklist.length, adminOnly: true },
  ] as const

  const visibleTabs = allTabs.filter(t => !t.adminOnly || isAdmin)

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-white tracking-tight">Moderation</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Reports, messages, event queue{isAdmin ? ', banned users, and blacklist' : ''}</p>
      </div>

      {/* Tabs + search. Search adapts to the active tab — placeholder
          spells out which fields it actually matches against so the
          moderator doesn't type a reason hoping the Reports tab will
          match it. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex flex-wrap gap-1 bg-zinc-900 rounded-xl p-1 w-fit border border-zinc-800">
          {visibleTabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key as typeof tab)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-1.5 ${
                tab === t.key ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'
              }`}>
              {t.label}
              {t.badge > 0 && (
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${
                  t.key === 'reports' && pendingCount > 0
                    ? 'bg-red-500 text-white'
                    : 'bg-zinc-600 text-zinc-300'
                }`}>{t.badge}</span>
              )}
            </button>
          ))}
        </div>
        {!loading && tab !== 'blacklist' && (
          <div className="relative flex-1 max-w-xs">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder={
                tab === 'reports'  ? 'Search reporter, reported, reason…' :
                tab === 'messages' ? 'Search user, text, event…' :
                tab === 'events'   ? 'Search title, host, club…' :
                                     'Search name, email, ban reason…'
              }
              className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500" />
          </div>
        )}
      </div>

      <LoadErrorBanner message={loadError} onRetry={() => load()} title="Couldn't load part of the moderation queue" />

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-32 bg-zinc-900 rounded-2xl border border-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : tab === 'reports' ? (
        <div className="space-y-4">
          <div className="flex gap-1.5">
            {([
              { key: 'all',       label: 'All',       count: reports.length },
              { key: 'pending',   label: 'Pending',   count: reports.filter(r => r.status === 'pending').length },
              { key: 'actioned',  label: 'Actioned',  count: reports.filter(r => r.status === 'actioned').length },
              { key: 'dismissed', label: 'Dismissed', count: reports.filter(r => r.status === 'dismissed').length },
            ] as const).map(f => f.count > 0 || f.key === 'all' || f.key === 'pending' ? (
              <button key={f.key} onClick={() => setStatusFilter(f.key)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors border ${
                  statusFilter === f.key
                    ? 'bg-amber-500 text-white border-amber-500'
                    // Unselected pills reuse STATUS_COLORS so each filter
                    // visually previews the status it represents — the
                    // map was already defined for the row badges and was
                    // being ignored here.
                    : `${STATUS_COLORS[f.key] ?? 'bg-zinc-800 text-zinc-400'} border-zinc-700 hover:opacity-80`
                }`}>
                {f.label} {f.count > 0 && `(${f.count})`}
              </button>
            ) : null)}
            {/* Survey-source toggle pill — sits next to the status
                pills because the reasoning the moderator makes
                ("triage these as anonymous-anomaly flags") is
                orthogonal to status. Only renders when there's at
                least one survey-source report so the chip doesn't
                clutter the empty state. */}
            {surveyReportCount > 0 && (
              <button onClick={() => setSurveyOnly(s => !s)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors border ${
                  surveyOnly
                    ? 'bg-violet-500 text-white border-violet-500'
                    : 'bg-violet-500/10 text-violet-400 border-violet-500/30 hover:opacity-80'
                }`}
                title="Reports auto-filed by the post-event safety survey">
                ✿ From surveys ({surveyReportCount})
              </button>
            )}
          </div>

          {visibleReports.length === 0 ? (
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-10 text-center">
              <div className="text-3xl mb-2">✅</div>
              <div className="text-zinc-400 text-sm">No {statusFilter !== 'all' ? statusFilter : ''} reports.</div>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleReports.map(r => (
                <div key={r.id} className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 flex flex-col gap-3">
                  <div className="flex items-start gap-4">
                  <Avatar name={r.reported.name} color={r.reported.color} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-white">{r.reported.name}</span>
                      {r.reported.status === 'banned' && (
                        <span className="text-xs bg-red-500/10 text-red-400 font-semibold px-1.5 py-0.5 rounded-full">Banned</span>
                      )}
                      {/* Corroboration at a glance: one report against someone
                          several people have already blocked is a different
                          case from a first-time complaint. */}
                      {!!r.reportedBlockCount && (
                        <span
                          title={`${r.reportedBlockCount} member${r.reportedBlockCount === 1 ? ' has' : 's have'} blocked this person`}
                          className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${
                            r.reportedBlockCount >= 2
                              ? 'bg-red-500/10 text-red-400'
                              : 'bg-zinc-700/50 text-zinc-300'}`}>
                          🚫 {r.reportedBlockCount}
                        </span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[r.status] ?? STATUS_COLORS.pending}`}>
                        {r.status}
                      </span>
                    </div>
                    <div className="text-sm font-medium text-zinc-300 mb-0.5">{REASON_LABELS[r.reason] ?? r.reason}</div>
                    {r.event && (
                      <Link href={`/events/${r.event.id}`} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-amber-500 hover:underline mb-1 block">
                        📅 {r.event.title}
                      </Link>
                    )}
                    {r.boardPost && (
                      <Link href={`/board?post=${r.boardPost.id}`} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-amber-500 hover:underline mb-1 block">
                        📋 {r.boardPost.title}
                        {!r.boardReply && r.boardPost.status === 'removed' && <span className="text-zinc-500"> (already removed)</span>}
                      </Link>
                    )}
                    {r.boardReply && (
                      <p className="text-xs text-zinc-400 mb-1 line-clamp-2">
                        💬 Reply: &ldquo;{r.boardReply.body.slice(0, 120)}&rdquo;
                        {r.boardReply.removed && <span className="text-zinc-500"> (already removed)</span>}
                      </p>
                    )}
                    {r.listing && (
                      <Link href={`/admin/listings/${r.listing.id}`}
                        className="text-xs text-amber-500 hover:underline mb-1 block">
                        🛍️ {r.listing.title}
                        {r.listing.status !== 'active' && <span className="text-zinc-500"> (already removed)</span>}
                      </Link>
                    )}
                    {r.neighborhoodPost && (
                      <Link href={`/neighborhoods/${r.neighborhoodPost.slug}`} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-amber-500 hover:underline mb-1 block">
                        🏘️ {r.neighborhoodPost.neighborhood}: &ldquo;{r.neighborhoodPost.content.slice(0, 80)}&rdquo;
                      </Link>
                    )}
                    {r.details && <p className="text-xs text-zinc-500 mb-1 line-clamp-2">"{r.details}"</p>}
                    <div className="text-xs text-zinc-600">
                      By <span className="text-zinc-400">{r.reporter.name}</span> · {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                    {r.reviewNote && (
                      <div className="text-xs text-zinc-500 mt-1 italic">Note: {r.reviewNote}</div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                    {r.status === 'pending' && (
                      <button onClick={() => triageReport(r.id)} disabled={triageLoading === r.id}
                        className="text-xs bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-50">
                        {triageLoading === r.id ? '⏳' : triageResults[r.id] ? '✦ Re-triage' : '✦ AI Triage'}
                      </button>
                    )}
                    {isAdmin && (
                      <Link href={`/admin/users/${r.reported.id}`}
                        className="text-xs border border-zinc-700 px-3 py-2 rounded-lg text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors">
                        Profile
                      </Link>
                    )}
                    {r.status === 'pending' && (
                      <button onClick={() => { setSelected(r); setReviewNote(''); setBanReason('') }}
                        className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded-lg font-medium transition-colors">
                        Review
                      </button>
                    )}
                  </div>
                  </div>
                  {triageResults[r.id] && (() => {
                    const t = triageResults[r.id]
                    const color = t.recommendation === 'ban' ? { bg: 'bg-red-500/10', border: 'border-red-500/20', badge: 'bg-red-500/20 text-red-400' }
                      : t.recommendation === 'warn' ? { bg: 'bg-amber-500/10', border: 'border-amber-500/20', badge: 'bg-amber-500/20 text-amber-400' }
                      : { bg: 'bg-green-500/10', border: 'border-green-500/20', badge: 'bg-green-500/20 text-green-400' }
                    return (
                      <div className={`rounded-xl border p-3 ${color.bg} ${color.border}`}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">AI Triage</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full capitalize ${color.badge}`}>
                            {t.recommendation === 'ban' ? '✕ Ban' : t.recommendation === 'warn' ? '⚠ Warn' : '○ Dismiss'}
                          </span>
                          <span className="text-xs text-zinc-500">{t.confidence}% confidence</span>
                        </div>
                        <p className="text-xs text-zinc-300 leading-relaxed">{t.reasoning}</p>
                      </div>
                    )
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>

      ) : tab === 'messages' ? (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">200 most recent event messages. Delete any that violate community guidelines.</p>

          {/* Bulk-action bar — only shows once anything is selected.
              Mirrors the toolkit on /admin/users; lets a moderator clear
              a thread of spam in one click instead of N. */}
          {selectedMsgs.size > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex flex-wrap items-center gap-2 sticky top-0 z-30">
              <span className="text-sm font-bold text-amber-300">{selectedMsgs.size} selected</span>
              <span className="flex-1" />
              <button onClick={handleBulkDeleteMessages} disabled={bulkDeleting}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 disabled:opacity-50 transition-colors">
                Delete
              </button>
              <button onClick={() => setSelectedMsgs(new Set())} disabled={bulkDeleting}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg text-zinc-400 hover:text-white disabled:opacity-50 transition-colors">
                Clear
              </button>
            </div>
          )}

          {visibleMessages.length === 0 ? (
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-10 text-center">
              <div className="text-3xl mb-2">💬</div>
              <div className="text-zinc-400 text-sm">{messages.length === 0 ? 'No messages yet.' : 'No messages match.'}</div>
            </div>
          ) : (
            <div className="space-y-2">
              {/* "Select all visible" header — only renders once the list
                  is non-empty. Clicking it toggles every row that
                  currently matches the search. */}
              <div className="flex items-center gap-3 px-4 py-2 text-xs text-zinc-500">
                <input type="checkbox" checked={allVisibleMsgsSelected}
                  onChange={() => setSelectedMsgs(prev => {
                    const next = new Set(prev)
                    if (visibleMessages.every(m => next.has(m.id))) {
                      for (const m of visibleMessages) next.delete(m.id)
                    } else {
                      for (const m of visibleMessages) next.add(m.id)
                    }
                    return next
                  })}
                  className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-800 text-amber-500 focus:ring-amber-500 cursor-pointer" />
                <span>Select all visible</span>
              </div>
              {visibleMessages.map(m => (
                <div key={m.id} className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-3 flex items-start gap-3">
                  <input type="checkbox" checked={selectedMsgs.has(m.id)}
                    onChange={() => setSelectedMsgs(prev => {
                      const next = new Set(prev)
                      if (next.has(m.id)) next.delete(m.id); else next.add(m.id)
                      return next
                    })}
                    className="w-3.5 h-3.5 rounded border-zinc-700 bg-zinc-800 text-amber-500 focus:ring-amber-500 cursor-pointer mt-1 shrink-0" />
                  <Avatar name={m.user.name} color={m.user.color} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-white">{m.user.name}</span>
                      {m.user.role !== 'member' && (
                        <span className="text-xs bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded-full capitalize">{m.user.role}</span>
                      )}
                      <span className="text-xs text-zinc-600">
                        in <Link href={`/events/${m.event.id}`} className="text-zinc-400 hover:text-white">{m.event.title}</Link>
                      </span>
                    </div>
                    <p className="text-sm text-zinc-300 break-words">{m.message}</p>
                    <p className="text-xs text-zinc-600 mt-0.5">{new Date(m.createdAt).toLocaleString()}</p>
                  </div>
                  <button onClick={() => handleDeleteMessage(m.id)}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors shrink-0 mt-0.5">
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      ) : tab === 'events' ? (
        <div className="space-y-4">
          <p className="text-xs text-zinc-500">
            Events waiting for review before they go live — submitted by members, or free events scheduled more than a week out.
            Approve publishes the event and tells the host; reject keeps it off the public listings.
          </p>
          {visibleQueue.length === 0 ? (
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-10 text-center">
              <div className="text-3xl mb-2">✅</div>
              <div className="text-zinc-400 text-sm">{queue.length === 0 ? 'No events pending review.' : 'No events match.'}</div>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleQueue.map(e => (
                <div key={e.id} className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Link href={`/events/${e.id}`} className="text-sm font-semibold text-white hover:text-amber-400 transition-colors">
                          {e.title}
                        </Link>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${EVENT_STATUS_COLORS[e.status] ?? 'bg-zinc-700 text-zinc-400'}`}>
                          {e.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-zinc-500 mb-2">
                        {/* host/club are nullable (deleted host, club-less
                            event) — this crashed the whole tab. Price is in
                            the event's currency; the date is a bare day, so
                            formatDay (new Date() parsed it as UTC midnight
                            and showed the day before west of Greenwich). */}
                        <span>Host: <span className="text-zinc-300">{e.host?.name ?? 'Deleted member'}</span></span>
                        <span>Club: <span className="text-zinc-300">{e.club?.name ?? 'No club'}</span></span>
                        <span>{formatMoney(e.price, e.currency ?? cur)} · {e.totalSpots} spots</span>
                        <span>{formatDay(e.date)}</span>
                      </div>
                      {e.description && (
                        <p className="text-xs text-zinc-500 line-clamp-2 mb-2">{e.description}</p>
                      )}
                      {!e.description && (
                        <p className="text-xs text-red-400 mb-2">⚠ No description provided</p>
                      )}
                      {!e.address && (
                        <p className="text-xs text-amber-400">⚠ No address provided</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <Link href={`/admin/events/${e.id}/edit`}
                        className="text-xs border border-zinc-700 px-3 py-2 rounded-lg text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors text-center">
                        Edit
                      </Link>
                      <button onClick={() => handleEventDecision(e, 'approve')}
                        className="text-xs bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 px-3 py-2 rounded-lg transition-colors font-medium">
                        Approve
                      </button>
                      <button onClick={() => handleEventDecision(e, 'reject')}
                        className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-2 rounded-lg transition-colors font-medium">
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      ) : tab === 'banned' ? (
        <div className="space-y-3">
          {visibleBanned.length === 0 ? (
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-10 text-center">
              <div className="text-3xl mb-2">✅</div>
              <div className="text-zinc-400 text-sm">{banned.length === 0 ? 'No banned users.' : 'No banned users match.'}</div>
            </div>
          ) : visibleBanned.map(u => (
            <div key={u.id} className={`bg-zinc-900 rounded-2xl border p-5 ${
              u.appealStatus === 'pending' ? 'border-amber-500/40' : 'border-zinc-800'
            }`}>
              <div className="flex items-start gap-4">
                <Avatar name={u.name} color={u.color} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-sm font-semibold text-white">{u.name}</div>
                    {u.appealStatus === 'pending' && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        Appeal pending
                      </span>
                    )}
                    {u.appealStatus === 'rejected' && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-400">
                        Appeal rejected
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500">{u.email}</div>
                  {u.banReason && (
                    <div className="text-xs text-red-400 mt-0.5">Ban reason: {u.banReason}</div>
                  )}
                  {u.bannedAt && (
                    <div className="text-xs text-zinc-600 mt-0.5">
                      Banned {new Date(u.bannedAt).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                  <Link href={`/admin/users/${u.id}`}
                    className="text-xs border border-zinc-700 px-3 py-2 rounded-lg text-zinc-400 hover:text-white transition-colors">
                    Profile
                  </Link>
                  <button onClick={() => handleUnban(u.id)}
                    className="text-xs bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 px-3 py-2 rounded-lg transition-colors font-medium">
                    Unban
                  </button>
                </div>
              </div>

              {/* Appeal section */}
              {u.appealNote && (
                <div className="mt-4 ml-11 bg-zinc-800/60 border border-zinc-700 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-bold text-amber-400 uppercase tracking-wide">Appeal message</p>
                    {u.appealedAt && (
                      <span className="text-xs text-zinc-600">
                        {new Date(u.appealedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-zinc-300 mb-3">"{u.appealNote}"</p>
                  {u.appealStatus === 'pending' && (
                    <div className="flex gap-2">
                      <button onClick={() => handleAppeal(u.id, 'approved')}
                        className="text-xs bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 px-3 py-2 rounded-lg font-semibold transition-colors">
                        Approve appeal — unban
                      </button>
                      <button onClick={() => handleAppeal(u.id, 'rejected')}
                        className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-2 rounded-lg font-semibold transition-colors">
                        Reject appeal
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

      ) : (
        /* Blacklist tab — admin only */
        <div className="space-y-5">
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6">
            <h2 className="font-bold text-white mb-4">Add to blacklist</h2>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">Email</label>
                <input value={blEmail} onChange={e => setBlEmail(e.target.value)} placeholder="user@example.com" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">Phone</label>
                <input value={blPhone} onChange={e => setBlPhone(e.target.value)} placeholder={`${dialCode(country)}…`} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">Name (optional)</label>
                <input value={blName} onChange={e => setBlName(e.target.value)} placeholder="For reference" className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1">Reason *</label>
                <input value={blReason} onChange={e => setBlReason(e.target.value)} placeholder="Why they're blocked" className={inputCls} />
              </div>
            </div>
            <button onClick={handleAddBlacklist} disabled={blSaving || !blReason}
              className="px-5 py-2 text-sm font-semibold bg-zinc-700 hover:bg-zinc-600 text-white rounded-xl transition-colors disabled:opacity-50">
              {blSaving ? 'Adding…' : 'Add to blacklist'}
            </button>
          </div>

          {blacklist.length === 0 ? (
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-8 text-center text-zinc-500 text-sm">Blacklist is empty.</div>
          ) : (
            <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-zinc-800">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Email</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 hidden sm:table-cell">Phone</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 hidden sm:table-cell">Name</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Reason</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 hidden md:table-cell">Added</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {blacklist.map(b => (
                      <tr key={b.id} className="hover:bg-zinc-800/40 transition-colors">
                        <td className="px-4 py-3 text-zinc-300">{b.email ?? '—'}</td>
                        <td className="px-4 py-3 text-zinc-300 hidden sm:table-cell">{b.phone ?? '—'}</td>
                        <td className="px-4 py-3 text-zinc-300 hidden sm:table-cell">{b.name ?? '—'}</td>
                        <td className="px-4 py-3 text-zinc-500 max-w-[200px] truncate">{b.reason}</td>
                        <td className="px-4 py-3 text-zinc-600 text-xs hidden md:table-cell">{new Date(b.createdAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => handleRemoveBlacklist(b.id)}
                            className="text-xs text-red-400 hover:text-red-300 transition-colors">Remove</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Freshness footer — same auto-refresh contract as /admin/users
          and /admin/applications. Hidden until the first fetch lands. */}
      {!loading && refreshLabel && (
        <p className="text-xs text-zinc-600 text-right pt-2">{refreshLabel}</p>
      )}

      {/* Review modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-bold text-white">Review report</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  <span className="text-zinc-200">{selected.reporter.name}</span> reported <span className="text-zinc-200">{selected.reported.name}</span>
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="text-zinc-500 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="bg-zinc-800 rounded-xl p-3 mb-4">
              <div className="text-xs font-semibold text-amber-400 mb-1">{REASON_LABELS[selected.reason] ?? selected.reason}</div>
              {selected.details && <p className="text-sm text-zinc-300">"{selected.details}"</p>}
            </div>

            <div className="mb-3">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Internal note / warning message</label>
              <textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)}
                placeholder="This will be sent to the user if you choose Warn…"
                rows={2} className="w-full px-3 py-2 text-sm border border-zinc-700 rounded-xl bg-zinc-800 text-white placeholder-zinc-600 resize-none focus:outline-none focus:ring-2 focus:ring-amber-500" />
            </div>

            {isAdmin && (
              <div className="mb-4">
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                  Ban reason <span className="text-zinc-600">(required to ban)</span>
                </label>
                <input value={banReason} onChange={e => setBanReason(e.target.value)}
                  placeholder="e.g. Harassment after repeated warnings"
                  className="w-full px-3 py-2 text-sm border border-zinc-700 rounded-xl bg-zinc-800 text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-red-500" />
              </div>
            )}

            {boardContentLive && (
              <div className="mb-4 bg-zinc-800/60 border border-zinc-700 rounded-xl p-3">
                {selected.boardReply
                  ? <p className="text-sm text-zinc-300 mb-2">&ldquo;{selected.boardReply.body}&rdquo;</p>
                  : <p className="text-sm text-zinc-300 mb-2"><span className="font-semibold">{selected.boardPost!.title}</span>{selected.boardPost!.body && <> — {selected.boardPost!.body.slice(0, 200)}</>}</p>}
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  <input type="checkbox" checked={removeContent} onChange={e => setRemoveContent(e.target.checked)} />
                  Also remove this {selected.boardReply ? 'reply' : 'post'} when warning or banning
                </label>
                <button onClick={() => handleAction('remove')} disabled={saving}
                  className="mt-2 w-full py-2 text-sm font-semibold bg-zinc-700 hover:bg-zinc-600 text-white rounded-xl transition-colors disabled:opacity-50">
                  Remove {selected.boardReply ? 'reply' : 'post'} only
                </button>
              </div>
            )}

            <div className={`grid gap-2 ${isAdmin ? 'grid-cols-3' : 'grid-cols-2'} mb-2`}>
              <button onClick={() => handleAction('dismiss')} disabled={saving}
                className="py-2.5 text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl transition-colors disabled:opacity-50">
                Dismiss
              </button>
              <button onClick={() => handleAction('warn')} disabled={saving}
                className="py-2.5 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-xl transition-colors disabled:opacity-50">
                {saving ? '…' : 'Warn'}
              </button>
              {isAdmin && (
                <button onClick={() => handleAction('ban')} disabled={saving || !banReason.trim()}
                  className="py-2.5 text-sm font-semibold bg-red-500 hover:bg-red-600 text-white rounded-xl transition-colors disabled:opacity-40">
                  {saving ? '…' : 'Ban'}
                </button>
              )}
            </div>
            <p className="text-xs text-zinc-600 mt-2 text-center">
              Warn sends a notification to the member
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
