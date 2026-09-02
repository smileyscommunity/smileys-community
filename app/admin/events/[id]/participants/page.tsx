'use client'

import { useState, useEffect, useRef, use } from 'react'
import { confirmToast } from '@/lib/confirmToast'
import Link from 'next/link'
import { toast } from 'sonner'
import { promptToast } from '@/lib/promptToast'
import { formatDate } from '@/lib/data'
import type { Event } from '@/lib/data'
import UserAvatar from '@/components/UserAvatar'
import WhatsAppButton from '@/components/WhatsAppButton'
import { useAdminMemberSearch } from '@/hooks/useAdminMemberSearch'

interface NoShowCard { id: string; userId: string; kind: 'yellow' | 'red'; status: string; waivedAt: string | null; user: { id: string; name: string } }

interface AttendeeUser { id: string; name: string; color: string; email: string; profilePhoto?: string | null; gender?: string | null; nationality?: string | null; phone?: string | null; noShowCount?: number }
interface Attendee    { userId: string; status: string; checkedIn: boolean; joinedAt: string; isStaff?: boolean; user: AttendeeUser }
interface WaitlistEntry { id: string; userId: string; createdAt: string; user: AttendeeUser }
interface PaymentRow  { id: string; userId: string; status: string; amount: number; currency: string }

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/40 transition-colors">
      {children}
    </div>
  )
}

function SectionHeader({ title, count, color, badge, children }: {
  title: string; count: number; color: string; badge?: string; children?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-900/80">
      <div className="flex items-center gap-2">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>{count}</span>
        <span className="font-bold text-white text-sm">{title}</span>
        {badge && <span className="text-xs text-zinc-500">{badge}</span>}
      </div>
      {children}
    </div>
  )
}

export default function ParticipantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [event,     setEvent]     = useState<Event | null>(null)
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [waitlist,  setWaitlist]  = useState<WaitlistEntry[]>([])
  // No-show cards from this event (yellow/red, any status) — the host's
  // waive button lives here. Late-cancel cards have no attendee row above.
  const [noShowCards, setNoShowCards] = useState<NoShowCard[]>([])
  // userId → live payment row (paid/pending). Only rendered for
  // Smileys-collected priced events.
  const [payments,  setPayments]  = useState<Record<string, PaymentRow>>({})
  const [payBusy,   setPayBusy]   = useState<string | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [toggling,  setToggling]  = useState<string | null>(null)
  const [busy,      setBusy]      = useState<string | null>(null)
  const [addSearch, setAddSearch] = useState('')
  // Server-side search — the users endpoint returns at most 1000 rows
  // without a ?search= param, so filtering a one-shot fetch client-side
  // made the oldest members unfindable in this picker.
  const { results: memberHits, searching } = useAdminMemberSearch(addSearch)
  const [attendeeView,   setAttendeeView]   = useState<'all' | 'checkedin' | 'noshows'>('all')
  // Payment filter — set by tapping the ₺ Paid stat tile or the segmented
  // control on the Approved section (only rendered for Smileys-collected
  // priced events).
  const [payView,        setPayView]        = useState<'all' | 'paid' | 'unpaid'>('all')
  // Turkish-male quota filter — toggled by tapping the 🇹🇷 tile.
  const [trOnly,         setTrOnly]         = useState(false)
  const pendingRef  = useRef<HTMLDivElement>(null)
  const waitlistRef = useRef<HTMLDivElement>(null)
  const [notifying,      setNotifying]      = useState(false)
  const [reminding,      setReminding]      = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/app/api/events/${id}`, { credentials: 'include' }).then(r => r.json()),
      fetch(`/app/api/admin/events/${id}/participants`, { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/admin/users', { credentials: 'include' }).then(r => r.json()),
    ]).then(([ev, data, users]) => {
      setEvent(ev)
      // The users list here only feeds the no-show badge on existing
      // attendees — the add-participant picker searches the server.
      const userList: AttendeeUser[] = Array.isArray(users) ? users : []
      const noShowMap = new Map(userList.map((u: AttendeeUser) => [u.id, u.noShowCount ?? 0]))
      const mergeNoShow = (a: Attendee): Attendee => ({ ...a, user: { ...a.user, noShowCount: noShowMap.get(a.userId) ?? 0 } })
      setAttendees(Array.isArray(data.attendees) ? data.attendees.map(mergeNoShow) : [])
      setWaitlist(Array.isArray(data.waitlist)   ? data.waitlist  : [])
      setNoShowCards(Array.isArray(data.noShowCards) ? data.noShowCards : [])
      if (Array.isArray(data.payments)) {
        // Latest row per user, 'paid' winning over a stray older 'pending'.
        const map: Record<string, PaymentRow> = {}
        for (const p of data.payments as PaymentRow[]) {
          if (!map[p.userId] || map[p.userId].status !== 'paid') map[p.userId] = p
        }
        setPayments(map)
      }
    }).finally(() => setLoading(false))
  }, [id])

  async function approveAttendee(userId: string) {
    setBusy(userId)
    const res = await fetch(`/app/api/admin/events/${id}/participants`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action: 'approve' }),
    })
    if (res.ok) { setAttendees(prev => prev.map(a => a.userId === userId ? { ...a, status: 'approved' } : a)); toast.success('Approved ✓') }
    setBusy(null)
  }

  async function rejectAttendee(userId: string) {
    if (!(await confirmToast('Reject and remove this request?'))) return
    setBusy(userId)
    const res = await fetch(`/app/api/admin/events/${id}/participants`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action: 'reject' }),
    })
    if (res.ok) { setAttendees(prev => prev.filter(a => a.userId !== userId)); toast('Rejected') }
    setBusy(null)
  }

  async function removeAttendee(userId: string) {
    if (!(await confirmToast('Remove this attendee?'))) return
    setBusy(userId)
    const res = await fetch(`/app/api/admin/events/${id}/participants`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, type: 'attendee' }),
    })
    if (res.ok) { setAttendees(prev => prev.filter(a => a.userId !== userId)); toast('Removed') }
    setBusy(null)
  }

  // Frees the spot without telling someone they're out — the move a host wants
  // for an attendee who is over a gender cap, or when a spot has to open up.
  // They keep a place in the queue rather than losing the event entirely.
  async function moveToWaitlist(userId: string) {
    if (!(await confirmToast('Move this attendee to the waitlist?'))) return
    setBusy(userId)
    const res = await fetch(`/app/api/admin/events/${id}/participants`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action: 'toWaitlist' }),
    })
    if (res.ok) {
      // Move it in the UI rather than reloading: the row leaves the attendee
      // list and joins the waitlist below, which is exactly what happened. The
      // id and createdAt come from the response, not from a guess here.
      const { waitlisted } = await res.json().catch(() => ({ waitlisted: null }))
      const moved = attendees.find(a => a.userId === userId)
      setAttendees(prev => prev.filter(a => a.userId !== userId))
      if (moved && waitlisted) {
        setWaitlist(prev => [...prev, { ...waitlisted, createdAt: String(waitlisted.createdAt), user: moved.user }])
      }
      toast('Moved to waitlist')
    } else {
      toast.error('Could not move to waitlist')
    }
    setBusy(null)
  }

  async function toggleCheckin(userId: string, current: boolean) {
    setToggling(userId)
    const res = await fetch(`/app/api/events/${id}/checkin`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, checkedIn: !current }),
    })
    if (res.ok) setAttendees(prev => prev.map(a => a.userId === userId ? { ...a, checkedIn: !current } : a))
    setToggling(null)
  }

  async function togglePaid(userId: string, currentlyPaid: boolean) {
    setPayBusy(userId)
    try {
      const res = await fetch(`/app/api/admin/events/${id}/participants`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action: currentlyPaid ? 'markUnpaid' : 'markPaid' }),
      })
      const data = await res.json()
      if (res.ok && data.payment) {
        setPayments(prev => ({ ...prev, [userId]: data.payment }))
      } else {
        toast.error(data.error ?? 'Could not update payment')
      }
    } catch {
      toast.error('Network error — check your connection')
    }
    setPayBusy(null)
  }

  async function waiveNoShow(card: NoShowCard) {
    const reason = await promptToast(`Clear ${card.user.name}'s no-show? Say why — it goes in the audit log.`,
      { placeholder: 'e.g. Was there, scanner missed them', confirmLabel: 'Clear it' })
    if (!reason) return
    setBusy(card.id)
    try {
      const res  = await fetch(`/app/api/events/${id}/no-shows/waive`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId: card.id, reason }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Could not clear'); return }
      setNoShowCards(prev => prev.map(c => c.id === card.id ? { ...c, status: 'waived', waivedAt: new Date().toISOString() } : c))
      toast.success('No-show cleared')
    } finally { setBusy(null) }
  }

  async function removeWaitlist(userId: string) {
    setBusy(userId)
    const res = await fetch(`/app/api/admin/events/${id}/participants`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, type: 'waitlist' }),
    })
    if (res.ok) { setWaitlist(prev => prev.filter(w => w.userId !== userId)); toast('Removed from waitlist') }
    setBusy(null)
  }

  async function addParticipant(user: AttendeeUser) {
    setBusy(user.id)
    const res = await fetch(`/app/api/admin/events/${id}/participants`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    })
    if (res.ok) {
      setAttendees(prev => [...prev, { userId: user.id, status: 'approved', checkedIn: false, joinedAt: new Date().toISOString(), user }])
      toast.success(`${user.name} added ✓`)
      setAddSearch('')
    } else {
      const err = await res.json()
      toast.error(err.error ?? 'Could not add participant')
    }
    setBusy(null)
  }

  async function promote(entry: WaitlistEntry) {
    setBusy(entry.userId)
    const res = await fetch(`/app/api/admin/events/${id}/participants`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: entry.userId }),
    })
    if (res.ok) {
      setWaitlist(prev => prev.filter(w => w.userId !== entry.userId))
      setAttendees(prev => [...prev, { userId: entry.userId, status: 'approved', checkedIn: false, joinedAt: new Date().toISOString(), user: entry.user }])
      toast.success(`${entry.user.name} promoted ✓`)
    }
    setBusy(null)
  }

  // In-app confirm (sonner) instead of window.confirm() — native dialogs
  // are suppressed in the installed PWA / some mobile browsers, which made
  // "Remind all" silently do nothing on mobile.
  function remindAttendees(count: number) {
    toast(`Send reminder email + notification to ${count} attendee${count !== 1 ? 's' : ''}?`, {
      action: {
        label: 'Send',
        onClick: async () => {
          setReminding(true)
          try {
            const res = await fetch(`/app/api/admin/events/${id}/remind-attendees`, {
              method: 'POST', credentials: 'include',
            })
            const data = await res.json()
            if (res.ok) toast.success(`Reminded ${data.emailed} via email · ${data.notified} in-app`)
            else toast.error(data.error ?? 'Failed to send reminders')
          } catch {
            toast.error('Failed to send reminders')
          } finally {
            setReminding(false)
          }
        },
      },
    })
  }

  async function notifyNoShows(count: number) {
    if (!(await confirmToast(`Send email + in-app notification to ${count} no-show${count !== 1 ? 's' : ''}?`))) return
    setNotifying(true)
    try {
      const res = await fetch(`/app/api/admin/events/${id}/notify-noshows`, {
        method: 'POST', credentials: 'include',
      })
      const data = await res.json()
      if (res.ok) toast.success(`Sent to ${data.emailed} email${data.emailed !== 1 ? 's' : ''} · ${data.notified} in-app`)
      else toast.error(data.error ?? 'Failed to notify')
    } catch {
      toast.error('Failed to notify')
    }
    setNotifying(false)
  }

  if (loading) return <div className="p-8 text-center text-zinc-500 text-sm">Loading…</div>
  if (!event)  return <div className="p-8 text-center text-zinc-500 text-sm">Event not found</div>

  const approved         = attendees.filter(a => a.status === 'approved')
  const isPastEvent      = event.date < new Date().toISOString().slice(0, 10)
  const pending          = attendees.filter(a => a.status === 'pending')
  const checkedInCount   = approved.filter(a => a.checkedIn).length
  const nonStaff         = approved.filter(a => !a.isStaff)
  const goingCount       = nonStaff.length
  const fillPct          = Math.min((goingCount / event.totalSpots) * 100, 100)
  const checkinPct       = Math.min((checkedInCount / event.totalSpots) * 100, 100)
  const turkishMaleQuota = (event as any).turkishMaleQuota as number | null
  const turkishMaleCount = turkishMaleQuota
    ? nonStaff.filter(a => a.user.gender === 'male' && a.user.nationality === 'Turkey').length
    : 0
  const femaleCount  = nonStaff.filter(a => a.user.gender === 'female').length
  const maleCount    = nonStaff.filter(a => a.user.gender === 'male').length
  const maleQuota    = (event as any).maleQuota   as number | null
  const femaleQuota  = (event as any).femaleQuota as number | null
  // Payment checklist — any priced event. Smileys-collected events arrive
  // with pending rows from RSVP; venue-paid events start empty and only get
  // rows when the admin marks someone paid (markPaid creates on demand), so
  // the phantom-pending problem can't return. Staff (host/cohosts) don't pay.
  const trackPayments = event.price > 0
  const paidCount     = trackPayments ? nonStaff.filter(a => payments[a.userId]?.status === 'paid').length : 0
  const outstanding   = trackPayments
    ? nonStaff.reduce((s, a) => payments[a.userId]?.status === 'paid' ? s : s + (payments[a.userId]?.amount ?? event.price), 0)
    : 0


  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/admin/events" className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xl">{event.emoji}</span>
            <h1 className="text-xl font-extrabold text-white truncate">{event.title}</h1>
          </div>
          <p className="text-xs text-zinc-500 mt-0.5">{formatDate(event.date)}</p>
        </div>
        <Link href={`/admin/events/${id}/edit`}
          className="shrink-0 text-xs px-3 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white transition-colors">
          Edit
        </Link>
      </div>

      {/* Stats */}
      <div className={`grid gap-2 grid-cols-2 sm:grid-cols-4 ${['lg:grid-cols-4', 'lg:grid-cols-5', 'lg:grid-cols-6'][(turkishMaleQuota ? 1 : 0) + (trackPayments ? 1 : 0)]}`}>
        {[
          { label: 'Going',      value: goingCount,         color: 'text-white',
            sub: (payView !== 'all' || attendeeView !== 'all' || trOnly) ? 'tap to clear filters' : `/ ${event.totalSpots}`,
            onClick: () => { setPayView('all'); setAttendeeView('all'); setTrOnly(false) } },
          { label: 'Checked in', value: checkedInCount,     color: 'text-green-400',
            sub: attendeeView === 'all' ? `${Math.round((checkedInCount / Math.max(goingCount,1))*100)}%` : `showing ${attendeeView === 'checkedin' ? 'checked-in' : 'no-shows'} ↓`,
            onClick: () => setAttendeeView(v => v === 'all' ? 'checkedin' : v === 'checkedin' ? 'noshows' : 'all') },
          { label: 'Pending',    value: pending.length,     color: pending.length  > 0 ? 'text-amber-400'  : 'text-zinc-600', sub: 'needs action',
            onClick: () => pendingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
          { label: 'Waitlist',   value: waitlist.length,    color: waitlist.length > 0 ? 'text-violet-400' : 'text-zinc-600', sub: 'in queue',
            onClick: () => waitlistRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
          ...(trackPayments ? [{
            label: '₺ Paid',
            value: paidCount,
            color: paidCount >= goingCount && goingCount > 0 ? 'text-green-400' : 'text-amber-400',
            sub: payView === 'all' ? `/ ${goingCount} · ₺${outstanding} due` : `showing ${payView} ↓`,
            onClick: () => setPayView(v => v === 'all' ? 'unpaid' : v === 'unpaid' ? 'paid' : 'all'),
          }] : []),
          ...(turkishMaleQuota ? [{
            label: '🇹🇷 TR male',
            value: turkishMaleCount,
            color: turkishMaleCount >= turkishMaleQuota ? 'text-red-400' : 'text-blue-400',
            sub: trOnly ? 'showing TR ♂ ↓' : `/ ${turkishMaleQuota} max`,
            onClick: () => setTrOnly(v => !v),
          }] : []),
        ].map(s => {
          const clickable = 'onClick' in s && typeof (s as { onClick?: () => void }).onClick === 'function'
          return (
            <div key={s.label}
              onClick={clickable ? (s as { onClick: () => void }).onClick : undefined}
              role={clickable ? 'button' : undefined}
              title={clickable ? 'Tap to filter or jump to the list' : undefined}
              className={`bg-zinc-900 rounded-xl border p-3 text-center ${clickable ? 'cursor-pointer border-amber-500/40 hover:border-amber-500 active:scale-[0.98] transition-all' : 'border-zinc-800'}`}>
              <div className={`text-2xl font-extrabold ${s.color}`}>{s.value}</div>
              <div className="text-xs font-semibold text-zinc-400 mt-0.5">{s.label}</div>
              <div className="text-xs text-zinc-600">{s.sub}</div>
            </div>
          )
        })}
      </div>

      {/* Capacity bar */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-3 space-y-1.5">
        <div className="flex justify-between text-xs text-zinc-500 mb-1">
          <span>Capacity</span>
          <span>{goingCount} / {event.totalSpots}{event.spotsLeft === 0 && <span className="ml-2 text-red-400 font-bold">FULL</span>}</span>
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${fillPct}%` }} />
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full bg-green-400 transition-all" style={{ width: `${checkinPct}%` }} />
        </div>
        {turkishMaleQuota && (
          <>
            <div className="flex justify-between text-xs text-zinc-500 pt-1">
              <span>🇹🇷 Turkish male quota</span>
              <span className={turkishMaleCount >= turkishMaleQuota ? 'text-red-400 font-bold' : ''}>
                {turkishMaleCount} / {turkishMaleQuota}{turkishMaleCount >= turkishMaleQuota && ' — FULL'}
              </span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-blue-500 transition-all"
                style={{ width: `${Math.min(100, (turkishMaleCount / turkishMaleQuota) * 100)}%` }} />
            </div>
          </>
        )}
        <div className="flex gap-4 text-xs text-zinc-600 pt-0.5">
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />Registered</span>
          <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />Checked in</span>
        </div>
      </div>

      {/* Gender balance */}
      {(event as any).genderBalance && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 px-4 py-3 space-y-2">
          <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Gender balance</p>
          <div>
            <div className="flex justify-between text-xs text-zinc-400 mb-1">
              <span>♀ Female</span>
              <span className="font-semibold text-pink-400">
                {femaleCount}{femaleQuota ? ` / ${femaleQuota} max` : ' going'}
              </span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-pink-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, (femaleQuota ?? event.totalSpots) > 0 ? (femaleCount / (femaleQuota ?? event.totalSpots)) * 100 : 0)}%` }} />
            </div>
            {femaleQuota && femaleCount >= femaleQuota && (
              <p className="text-xs text-red-400 mt-1">Female spots full</p>
            )}
          </div>
          <div>
            <div className="flex justify-between text-xs text-zinc-400 mb-1">
              <span>♂ Male</span>
              <span className={`font-semibold ${maleQuota && maleCount >= maleQuota ? 'text-red-400' : 'text-blue-400'}`}>
                {maleCount}{maleQuota ? ` / ${maleQuota} max` : ' going'}
              </span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${Math.min(100, (maleQuota ?? event.totalSpots) > 0 ? (maleCount / (maleQuota ?? event.totalSpots)) * 100 : 0)}%` }} />
            </div>
            {maleQuota && maleCount >= maleQuota && (
              <p className="text-xs text-red-400 mt-1">Male spots full</p>
            )}
          </div>
        </div>
      )}

      {/* ── ADD PARTICIPANT ── */}
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <span className="font-bold text-white text-sm">Add participant directly</span>
            <p className="text-xs text-zinc-500 mt-0.5">Bypass RSVP — add any member as approved</p>
          </div>
        </div>
        <div className="p-4">
          <div className="relative">
            <input
              value={addSearch}
              onChange={e => setAddSearch(e.target.value)}
              placeholder="Search member by name…"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-amber-500"
            />
            {addSearch.trim().length > 1 && (() => {
              const alreadyIn = new Set(attendees.map(a => a.userId))
              const results = memberHits.filter(u => !alreadyIn.has(u.id)).slice(0, 6)
              if (!results.length) return (
                <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-xs text-zinc-500 z-10">
                  {searching ? 'Searching…' : 'No members found'}
                </div>
              )
              return (
                <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden z-10 shadow-xl">
                  {results.map(u => (
                    <button key={u.id} onClick={() => addParticipant(u)} disabled={busy === u.id}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-700 transition-colors text-left disabled:opacity-40">
                      <UserAvatar user={u} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{u.name}</p>
                      </div>
                      <span className="text-xs text-amber-400 font-semibold shrink-0">Add →</span>
                    </button>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {/* ── PENDING ── */}
      {(pending.length > 0 || pending.length > 0) && (
        <div ref={pendingRef} className="bg-zinc-900 rounded-2xl border border-amber-500/30 overflow-hidden">
          <SectionHeader title="Pending approval" count={pending.length} color="bg-amber-500/20 text-amber-400">
            {pending.length > 0 && (
              <button onClick={() => pending.forEach(a => approveAttendee(a.userId))}
                className="text-xs px-3 py-2 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 font-semibold transition-colors">
                Approve all
              </button>
            )}
          </SectionHeader>
          {pending.length === 0
            ? <div className="px-4 py-6 text-center text-zinc-600 text-xs">'No pending requests'</div>
            : <div className="divide-y divide-zinc-800">
                {pending.map(a => (
                  <Row key={a.userId}>
                    <UserAvatar user={a.user} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{a.user.name}</p>
                      </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <WhatsAppButton user={a.user} />
                      <button onClick={() => approveAttendee(a.userId)} disabled={busy === a.userId}
                        className="text-xs px-3 py-2 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 font-semibold transition-colors disabled:opacity-40">
                        ✓ Approve
                      </button>
                      <button onClick={() => rejectAttendee(a.userId)} disabled={busy === a.userId}
                        className="text-xs px-3 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 font-semibold transition-colors disabled:opacity-40">
                        ✕ Reject
                      </button>
                    </div>
                  </Row>
                ))}
              </div>
          }
        </div>
      )}


      {/* ── APPROVED ── */}
      {(() => {
        const noShows = approved.filter(a => !a.checkedIn)
        const byCheckin = attendeeView === 'checkedin' ? approved.filter(a => a.checkedIn)
          : attendeeView === 'noshows' ? noShows
          : approved
        // Payment filter stacks on top. Staff never owe, so they only show
        // under 'all'.
        const byPay = payView === 'paid'
          ? byCheckin.filter(a => !a.isStaff && payments[a.userId]?.status === 'paid')
          : payView === 'unpaid'
          ? byCheckin.filter(a => !a.isStaff && payments[a.userId]?.status !== 'paid')
          : byCheckin
        const visibleApproved = trOnly
          ? byPay.filter(a => a.user.gender === 'male' && a.user.nationality === 'Turkey')
          : byPay
        return (
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
        <SectionHeader
          title="Approved"
          count={approved.length}
          color="bg-green-500/20 text-green-400"
        >
          <div className="flex items-center gap-2">
            {trackPayments && approved.length > 0 && (
              <div className="flex rounded-lg overflow-hidden border border-zinc-700 text-xs font-semibold">
                {(['all', 'paid', 'unpaid'] as const).map(v => (
                  <button key={v} onClick={() => setPayView(v)}
                    className={`px-2.5 py-1.5 transition-colors ${payView === v ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
                    {v === 'all' ? 'All' : v === 'paid' ? `₺ ${paidCount}` : `Unpaid ${goingCount - paidCount}`}
                  </button>
                ))}
              </div>
            )}
            {!isPastEvent && approved.length > 0 && (
              <button
                onClick={() => remindAttendees(approved.length)}
                disabled={reminding}
                className="flex items-center gap-1.5 text-xs px-2.5 py-2 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 font-semibold transition-colors disabled:opacity-40"
                title="Send reminder email + notification to all attendees"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                {reminding ? 'Sending…' : `Remind all (${approved.length})`}
              </button>
            )}
            {approved.length > 0 && (
              <div className="flex rounded-lg overflow-hidden border border-zinc-700 text-xs font-semibold">
                {(['all', 'checkedin', 'noshows'] as const).map(v => (
                  <button key={v} onClick={() => setAttendeeView(v)}
                    className={`px-2.5 py-1.5 transition-colors ${attendeeView === v ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
                    {v === 'all' ? `All ${approved.length}` : v === 'checkedin' ? `✓ ${checkedInCount}` : `✗ ${noShows.length}`}
                  </button>
                ))}
              </div>
            )}
            {isPastEvent && noShows.length > 0 && (
              <button
                onClick={() => notifyNoShows(noShows.length)}
                disabled={notifying}
                className="flex items-center gap-1.5 text-xs px-2.5 py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 font-semibold transition-colors disabled:opacity-40"
                title="Send email + in-app notification to no-shows"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                {notifying ? 'Sending…' : `Notify (${noShows.length})`}
              </button>
            )}
            {approved.length > 0 && (
              <button
                onClick={() => {
                  const headers = ['Name', 'Email', 'Status', 'Checked In', ...(trackPayments ? ['Paid'] : [])]
                  const rows = approved.map(a => [a.user.name, a.user.email, a.status, a.checkedIn ? 'Yes' : 'No',
                    ...(trackPayments ? [payments[a.userId]?.status === 'paid' ? 'Yes' : 'No'] : [])])
                  const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
                  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `${event?.title ?? 'event'}-attendees.csv` })
                  a.click()
                }}
                className="hidden sm:flex items-center gap-1.5 text-xs px-2.5 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-semibold transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                CSV
              </button>
            )}
          </div>
        </SectionHeader>
        {approved.length === 0
          ? <div className="px-4 py-6 text-center text-zinc-600 text-xs">'No approved attendees yet'</div>
          : visibleApproved.length === 0
          ? <div className="px-4 py-6 text-center text-zinc-600 text-xs">
              {payView === 'paid' ? 'Nobody marked paid yet'
                : payView === 'unpaid' ? 'Everyone has paid 🎉'
                : attendeeView === 'checkedin' ? 'Nobody checked in yet' : 'Everyone showed up!'}
            </div>
          : <div className="divide-y divide-zinc-800">
              {visibleApproved.map(a => (
                <Row key={a.userId}>
                  <UserAvatar user={a.user} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-white truncate">{a.user.name}</p>
                      {(a.user.noShowCount ?? 0) >= 3 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 shrink-0" title="Registered but didn't show up 3+ times">
                          ✗ {a.user.noShowCount}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <WhatsAppButton user={a.user} />
                    {trackPayments && !a.isStaff && (
                      <button
                        onClick={() => togglePaid(a.userId, payments[a.userId]?.status === 'paid')}
                        disabled={payBusy === a.userId}
                        title={payments[a.userId]?.status === 'paid' ? 'Mark as unpaid' : 'Mark as paid'}
                        className={`text-xs font-bold px-2 py-1 rounded-lg transition-colors disabled:opacity-40 ${
                          payments[a.userId]?.status === 'paid'
                            ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25'
                            : 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20'
                        }`}
                      >
                        {payBusy === a.userId ? '…' : payments[a.userId]?.status === 'paid' ? '₺ Paid' : '₺ Unpaid'}
                      </button>
                    )}
                    {/* No status pill — the check-in button's color carries
                        the state (gray = not in, green = checked in), and on
                        mobile the pill was crushing names to two letters. */}
                    <button onClick={() => toggleCheckin(a.userId, a.checkedIn)} disabled={toggling === a.userId}
                      title={a.checkedIn ? 'Undo check-in' : 'Check in'}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40 ${a.checkedIn ? 'bg-green-500 text-white' : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'}`}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                    {/* Between check-in and remove on purpose: it sits with
                        the other per-attendee actions, and next to the
                        destructive one it is the gentler alternative — the
                        attendee keeps a place in the queue. */}
                    <button onClick={() => moveToWaitlist(a.userId)} disabled={busy === a.userId}
                      title="Move to waitlist"
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-600 hover:text-amber-400 hover:bg-amber-500/10 transition-colors disabled:opacity-40">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7M17 15l3 3-3 3" />
                      </svg>
                    </button>
                    <button onClick={() => removeAttendee(a.userId)} disabled={busy === a.userId}
                      title="Remove attendee"
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </Row>
              ))}
            </div>
        }
      </div>
        )
      })()}

      {/* ── WAITLIST ── */}
      <div ref={waitlistRef} className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
        <SectionHeader title="Waitlist" count={waitlist.length} color="bg-violet-500/20 text-violet-400">
          {waitlist.length > 0 && event.spotsLeft > 0 && (
            <button onClick={() => waitlist.slice(0, event.spotsLeft).forEach(promote)}
              className="text-xs px-3 py-2 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 font-semibold transition-colors">
              Promote {Math.min(waitlist.length, event.spotsLeft)}
            </button>
          )}
        </SectionHeader>
        {waitlist.length === 0
          ? <div className="px-4 py-6 text-center text-zinc-600 text-xs">'Waitlist is empty'</div>
          : <div className="divide-y divide-zinc-800">
              {waitlist.map((w, i) => (
                <Row key={w.userId}>
                  <span className="text-xs font-bold text-zinc-600 w-5 text-center shrink-0">#{i + 1}</span>
                  <UserAvatar user={w.user} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{w.user.name}</p>
                  </div>
                  <p className="text-xs text-zinc-600 shrink-0">
                    {new Date(w.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <WhatsAppButton user={w.user} />
                    <button onClick={() => promote(w)} disabled={busy === w.userId}
                      className="text-xs px-3 py-2 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 font-semibold transition-colors disabled:opacity-40">
                      ↑ Promote
                    </button>
                    <button onClick={() => removeWaitlist(w.userId)} disabled={busy === w.userId}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </Row>
              ))}
            </div>
        }

        {/* Cards issued from this event by the no-show sweep. A host clears
            one when the attendance record was wrong; the card stays as a
            waived record, the attendee row keeps its mark. */}
        {noShowCards.length > 0 && (
          <div className="mt-4">
            <SectionHeader title="No-show cards" count={noShowCards.length} color="bg-red-500/20 text-red-400" />
            <div className="divide-y divide-zinc-800">
              {noShowCards.map(c => (
                <Row key={c.id}>
                  <span className="text-lg shrink-0" aria-hidden="true">{c.kind === 'red' ? '🟥' : '🟨'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{c.user.name}</p>
                    <p className="text-[11px] text-zinc-500">{c.kind === 'red' ? 'Second no-show — RSVPs pause after the appeal window' : 'First no-show — warning only'}</p>
                  </div>
                  {c.status === 'active' || c.status === 'appeal_pending'
                    ? <button onClick={() => waiveNoShow(c)} disabled={busy === c.id}
                        title="The attendance record was wrong — clear this card"
                        className="text-xs px-3 py-2 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 font-semibold transition-colors disabled:opacity-40">
                        Clear
                      </button>
                    : <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-zinc-800 text-zinc-500 uppercase">{c.status.replace('_', ' ')}</span>}
                </Row>
              ))}
            </div>
          </div>
        )}
      </div>


    </div>
  )
}
