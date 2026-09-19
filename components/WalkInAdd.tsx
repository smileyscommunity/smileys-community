'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { avatarUrl, getInitials } from '@/lib/data'
import { withCapacityConfirm, OVERRIDE_FLAG } from '@/lib/admin/overCapacity'

// "Add walk-in", on both door screens: someone turned up who isn't on the
// list. Search members, tap one, and they're seated and checked in — one tap
// instead of three screens (participants page → add → back to the roster).
// The seat goes through the same door as a manual add (PUT
// /api/admin/events/[id]/participants): a full event asks before seating
// them over capacity, like every other staff door. Then the page's own
// check-in runs for them, so the tap counts as an arrival.

interface Found { id: string; name: string; color: string; profilePhoto: string | null }

export default function WalkInAdd({ eventId, onAdded, exclude, dark = true }: {
  eventId:  string
  /** The seat is taken: reload the roster, then check this member in. */
  onAdded:  (userId: string) => Promise<void>
  /** Already on the roster: not offered. */
  exclude:  Set<string>
  dark?:    boolean
}) {
  const [open,    setOpen]    = useState(false)
  const [q,       setQ]       = useState('')
  const [found,   setFound]   = useState<Found[]>([])
  const [busy,    setBusy]    = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const query = q.trim()
    if (query.length < 2) { setFound([]); return }
    timer.current = setTimeout(() => {
      fetch(`/app/api/members/search?q=${encodeURIComponent(query)}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .then(d => setFound(Array.isArray(d) ? d.filter((u: Found) => !exclude.has(u.id)) : []))
        .catch(() => setFound([]))
    }, 250)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [q, exclude])

  async function seat(u: Found) {
    if (busy) return
    setBusy(u.id)
    try {
      const res = await withCapacityConfirm(allow => fetch(`/app/api/admin/events/${eventId}/participants`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: u.id, walkIn: true, ...(allow ? { [OVERRIDE_FLAG]: true } : {}) }),
      }))
      if (!res) return                                  // said no to exceeding capacity
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        toast.error(typeof d?.error === 'string' ? d.error : "Couldn't add them.")
        return
      }
      const d = await res.json().catch(() => null)
      // Outside the door window the server sends an invitation instead of a
      // seat — say so rather than claim a check-in that didn't happen.
      if (d?.invited) {
        toast.success(`Invitation sent to ${u.name} — they'll get a spot when they accept`)
        setQ(''); setFound([]); setOpen(false)
        return
      }
      await onAdded(u.id)
      toast.success(`${u.name} added and checked in`)
      setQ(''); setFound([]); setOpen(false)
    } catch {
      toast.error('No connection — nothing was changed.')
    } finally {
      setBusy(null)
    }
  }

  const box   = dark ? 'bg-zinc-800 border-zinc-700 text-white placeholder-zinc-500 focus:border-amber-500' : 'bg-white border-gray-300 text-gray-900 focus:ring-2 focus:ring-amber-400'
  const row   = dark ? 'bg-zinc-900 border-zinc-800 hover:border-zinc-600 text-white' : 'bg-white border-gray-200 hover:border-amber-300 text-gray-900'
  const muted = dark ? 'text-zinc-500' : 'text-gray-500'

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className={`w-full py-2.5 rounded-xl border text-sm font-semibold transition-colors ${dark ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
        + Add walk-in
      </button>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input autoFocus type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="Walk-in's name…"
          className={`flex-1 border text-sm rounded-xl px-4 py-2.5 focus:outline-none ${box}`} />
        <button onClick={() => { setOpen(false); setQ(''); setFound([]) }} className={`px-3 text-sm ${muted}`}>Cancel</button>
      </div>
      {q.trim().length >= 2 && found.length === 0 && <p className={`text-xs ${muted}`}>No member by that name. They need a Smileys account first.</p>}
      {found.map(u => {
        const photo = avatarUrl(u.profilePhoto, 128)
        return (
          <button key={u.id} onClick={() => seat(u)} disabled={busy !== null}
            className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-left disabled:opacity-50 ${row}`}>
            {photo
              ? <img src={photo} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
              : <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ backgroundColor: u.color }}>{getInitials(u.name)}</div>}
            <span className="flex-1 min-w-0 text-sm font-semibold truncate">{u.name}</span>
            <span className="text-xs font-bold text-amber-500 shrink-0">{busy === u.id ? 'Seating…' : 'Seat & check in'}</span>
          </button>
        )
      })}
    </div>
  )
}
