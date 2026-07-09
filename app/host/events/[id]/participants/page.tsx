'use client'

import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import UserAvatar from '@/components/UserAvatar'

interface AttendeeUser {
  id: string; name: string; color: string; email?: string; profilePhoto?: string | null
}
interface Attendee {
  userId: string; status: string; checkedIn: boolean; joinedAt: string; user: AttendeeUser
  paymentStatus?: 'paid' | 'pending' | 'none'
}
interface WaitlistEntry {
  id: string; userId: string; createdAt: string; user: AttendeeUser
}
interface Review {
  id: string; rating: number; text: string; createdAt: string
  user: { name: string; color: string }
}

function Stars({ n }: { n: number }) {
  return (
    <span className="text-amber-400 text-sm">
      {'★'.repeat(n)}{'☆'.repeat(5 - n)}
    </span>
  )
}

export default function HostParticipantsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [eventTitle, setEventTitle] = useState('')
  const [eventDate,  setEventDate]  = useState('')
  const [attendees,  setAttendees]  = useState<Attendee[]>([])
  const [waitlist,   setWaitlist]   = useState<WaitlistEntry[]>([])
  const [eventPrice, setEventPrice] = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [tab,        setTab]        = useState<'pending' | 'approved' | 'waitlist' | 'reviews'>('pending')
  const [addSearch,    setAddSearch]    = useState('')
  const [searchResults, setSearchResults] = useState<AttendeeUser[]>([])
  const [searching,    setSearching]    = useState(false)
  const [addBusy,      setAddBusy]      = useState<string | null>(null)
  const [reviews,        setReviews]        = useState<Review[]>([])
  const [reviewsLoaded,  setReviewsLoaded]  = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/app/api/events/${id}`, { credentials: 'include' }).then(r => r.json()),
      fetch(`/app/api/admin/events/${id}/participants`, { credentials: 'include' }).then(r => r.json()),
    ]).then(([ev, data]) => {
      if (ev?.title) setEventTitle(ev.title)
      if (ev?.date)  setEventDate(ev.date)
      setAttendees(Array.isArray(data.attendees) ? data.attendees : [])
      setWaitlist(Array.isArray(data.waitlist) ? data.waitlist : [])
      setEventPrice(data.eventPrice ?? 0)
    }).finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (addSearch.trim().length < 2) { setSearchResults([]); return }
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/app/api/search?q=${encodeURIComponent(addSearch)}&type=members`, { credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          const alreadyIn = new Set(attendees.map(a => a.userId))
          setSearchResults((data.members ?? []).filter((u: AttendeeUser) => !alreadyIn.has(u.id)).slice(0, 6))
        }
      } finally { setSearching(false) }
    }, 250)
    return () => clearTimeout(timer)
  }, [addSearch, attendees])

  async function loadReviews() {
    if (reviewsLoaded) return
    const res = await fetch(`/app/api/events/${id}/reviews`, { credentials: 'include' })
    if (res.ok) setReviews(await res.json())
    setReviewsLoaded(true)
  }

  function switchTab(t: typeof tab) {
    setTab(t)
    if (t === 'reviews') loadReviews()
  }

  const today  = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' })).toISOString().split('T')[0]
  const isPast = eventDate ? eventDate < today : false

  async function approve(userId: string) {
    const res = await fetch(`/app/api/admin/events/${id}/participants`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action: 'approve' }),
    })
    if (res.ok) { setAttendees(prev => prev.map(a => a.userId === userId ? { ...a, status: 'approved' } : a)); toast.success('Approved ✓') }
  }

  async function reject(userId: string) {
    if (!(await confirmToast('Reject this request?'))) return
    const res = await fetch(`/app/api/admin/events/${id}/participants`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, action: 'reject' }),
    })
    if (res.ok) { setAttendees(prev => prev.filter(a => a.userId !== userId)); toast('Rejected') }
  }

  async function addParticipant(user: AttendeeUser) {
    setAddBusy(user.id)
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
    setAddBusy(null)
  }

  async function promoteWaitlist(entry: WaitlistEntry) {
    const res = await fetch(`/app/api/admin/events/${id}/participants`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: entry.userId }),
    })
    if (res.ok) {
      setWaitlist(prev => prev.filter(w => w.userId !== entry.userId))
      const newAttendee: Attendee = { userId: entry.userId, status: 'approved', checkedIn: false, joinedAt: new Date().toISOString(), user: entry.user }
      setAttendees(prev => [...prev, newAttendee])
      toast.success(`${entry.user.name} approved ✓`)
    }
  }

  const pending  = attendees.filter(a => a.status === 'pending')
  const approved = attendees.filter(a => a.status === 'approved')

  function exportCsv() {
    const rows = [
      ['Name', 'Paid', 'Checked In', 'Joined At'],
      ...approved.map(a => [
        a.user.name,
        eventPrice > 0 ? (a.paymentStatus === 'paid' ? 'Yes' : 'No') : '—',
        a.checkedIn ? 'Yes' : 'No',
        new Date(a.joinedAt).toLocaleDateString('en-GB'),
      ]),
    ]
    const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `${(eventTitle || 'event').replace(/[^a-zA-Z0-9]/g, '-')}-attendees.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const [broadcastMsg,  setBroadcastMsg]  = useState('')
  const [broadcasting,  setBroadcasting]  = useState(false)
  const [broadcastSent, setBroadcastSent] = useState(false)

  async function broadcast() {
    if (!broadcastMsg.trim()) return
    setBroadcasting(true)
    const res = await fetch(`/app/api/host/events/${id}/broadcast`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: broadcastMsg }),
    })
    if (res.ok) { setBroadcastMsg(''); setBroadcastSent(true); toast.success('Message sent to all attendees') }
    else toast.error('Failed to send message')
    setBroadcasting(false)
  }

  if (loading) return <div className="p-8 text-center text-zinc-500 text-sm">Loading…</div>

  return (
    <div className="p-4 sm:p-8 space-y-6">

      <div className="flex items-center gap-3">
        <Link href="/host/events" className="text-zinc-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white">Participants</h1>
          {eventTitle && <p className="text-sm text-zinc-400 mt-0.5 truncate">{eventTitle}</p>}
        </div>
      </div>

      {/* Add participant */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">Add participant directly</p>
        <div className="relative">
          <input
            value={addSearch}
            onChange={e => setAddSearch(e.target.value)}
            placeholder="Search member by name…"
            className="w-full px-3 py-2.5 text-sm bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          {addSearch.trim().length > 1 && (() => {
            if (searching) return (
              <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-xs text-zinc-500 z-10">
                Searching…
              </div>
            )
            if (!searchResults.length) return (
              <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-xs text-zinc-500 z-10">
                No members found
              </div>
            )
            return (
              <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden z-10 shadow-xl">
                {searchResults.map(u => (
                  <button key={u.id} onClick={() => addParticipant(u)} disabled={addBusy === u.id}
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

      {/* Message all attendees */}
      {approved.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Message attendees</p>
            <span className="text-xs text-zinc-600">{approved.length} approved</span>
          </div>
          <textarea
            maxLength={500}
            value={broadcastMsg}
            onChange={e => { setBroadcastMsg(e.target.value); setBroadcastSent(false) }}
            rows={3}
            placeholder={`Send a message to all ${approved.length} confirmed attendees…`}
            className="w-full px-3 py-2.5 text-sm bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={broadcast}
              disabled={!broadcastMsg.trim() || broadcasting}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors disabled:opacity-40"
            >
              {broadcasting ? 'Sending…' : `Send to ${approved.length} attendees`}
            </button>
            <span className={`text-xs ml-auto ${broadcastMsg.length > 450 ? 'text-red-400' : 'text-zinc-600'}`}>
              {broadcastMsg.length}/500
            </span>
            {broadcastSent && <span className="text-xs text-green-400">Sent ✓</span>}
          </div>
        </div>
      )}

      <div className={`grid gap-3 ${isPast ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {[
          { label: 'Pending',  value: pending.length,  color: pending.length > 0 ? 'text-amber-400' : 'text-white' },
          { label: 'Approved', value: approved.length, color: 'text-green-400' },
          { label: 'Waitlist', value: waitlist.length, color: waitlist.length > 0 ? 'text-violet-400' : 'text-white' },
          ...(isPast ? [{ label: 'Reviews', value: reviewsLoaded ? reviews.length : '…', color: 'text-amber-400' }] : []),
        ].map(s => (
          <div key={s.label} className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 bg-zinc-800 rounded-xl p-1 w-fit flex-wrap">
        {([
          { key: 'pending',  label: `Pending (${pending.length})` },
          { key: 'approved', label: `Approved (${approved.length})` },
          { key: 'waitlist', label: `Waitlist (${waitlist.length})` },
          ...(isPast ? [{ key: 'reviews' as const, label: '⭐ Reviews' }] : []),
        ] as const).map(t => (
          <button key={t.key} onClick={() => switchTab(t.key as typeof tab)}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${tab === t.key ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'pending' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          {pending.length === 0 ? (
            <div className="p-10 text-center text-zinc-500 text-sm">No pending requests.</div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {pending.map(a => (
                <div key={a.userId} className="flex items-center gap-3 px-5 py-4">
                  <UserAvatar user={a.user} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{a.user.name}</p>
                    {a.user.email && <p className="text-xs text-zinc-500 truncate">{a.user.email}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => approve(a.userId)} className="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 text-xs font-semibold transition-colors">Approve</button>
                    <button onClick={() => reject(a.userId)} className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-semibold transition-colors">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'approved' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          {approved.length === 0 ? (
            <div className="p-10 text-center text-zinc-500 text-sm">No approved attendees yet.</div>
          ) : (
            <>
              <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
                <span className="text-xs text-zinc-500">{approved.length} attendee{approved.length !== 1 ? 's' : ''}</span>
                <button
                  onClick={exportCsv}
                  className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white border border-zinc-700 px-3 py-1.5 rounded-lg transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download CSV
                </button>
              </div>
            <div className="divide-y divide-zinc-800">
              {approved.map(a => (
                <div key={a.userId} className="flex items-center gap-3 px-5 py-4">
                  <UserAvatar user={a.user} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{a.user.name}</p>
                    {a.user.email && <p className="text-xs text-zinc-500 truncate">{a.user.email}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Payment status — paid events only. Operational view for the
                        host: who's settled up vs still owes, alongside check-in. */}
                    {eventPrice > 0 && (
                      a.paymentStatus === 'paid'
                        ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">💳 Paid</span>
                        : <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">Unpaid</span>
                    )}
                    {a.checkedIn && <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">Checked in</span>}
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      )}

      {tab === 'waitlist' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          {waitlist.length === 0 ? (
            <div className="p-10 text-center text-zinc-500 text-sm">No one on the waitlist.</div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {waitlist.map((w, i) => (
                <div key={w.userId} className="flex items-center gap-3 px-5 py-4">
                  <span className="text-xs font-bold text-zinc-600 w-5 text-center shrink-0">{i + 1}</span>
                  <UserAvatar user={w.user} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{w.user.name}</p>
                    <p className="text-xs text-zinc-500">{new Date(w.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</p>
                  </div>
                  <button onClick={() => promoteWaitlist(w)} className="px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 text-xs font-semibold transition-colors shrink-0">Approve</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'reviews' && (
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden">
          {!reviewsLoaded ? (
            <div className="p-10 text-center text-zinc-500 text-sm">Loading…</div>
          ) : reviews.length === 0 ? (
            <div className="p-10 text-center text-zinc-500 text-sm">No reviews yet.</div>
          ) : (
            <>
              {/* Summary bar */}
              <div className="px-5 py-4 border-b border-zinc-800 flex items-center gap-4">
                <div className="text-3xl font-bold text-white">
                  {(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)}
                </div>
                <div>
                  <Stars n={Math.round(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length)} />
                  <p className="text-xs text-zinc-500 mt-0.5">{reviews.length} review{reviews.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <div className="divide-y divide-zinc-800">
                {reviews.map(r => (
                  <div key={r.id} className="px-5 py-4">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: r.user.color }}>
                        {r.user.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-semibold text-white">{r.user.name}</span>
                        <span className="text-xs text-zinc-500 ml-2">{new Date(r.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                      </div>
                      <Stars n={r.rating} />
                    </div>
                    {r.text && <p className="text-sm text-zinc-300 leading-relaxed pl-10">{r.text}</p>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
