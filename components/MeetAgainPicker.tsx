'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import UserAvatar from '@/components/UserAvatar'

// "Would you meet them again?" — the private post-event pick (lib/meetAgain).
// Fetches its own eligibility and renders nothing when the viewer can't pick
// or there's nobody left to pick, so a page can drop it in unconditionally.
// Two skins: the dark survey page and the light event page.

interface Person { id: string; name: string; color: string; profilePhoto: string | null }
interface State { eligible: boolean; people?: Person[]; picked?: string[]; maxPicks?: number }

const SKINS = {
  dark: {
    wrap:  '',
    title: 'text-sm font-semibold text-white',
    sub:   'text-xs text-zinc-500',
    card:  'bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800',
    on:    'bg-amber-500/20 border-amber-500/40 text-amber-200',
    note:  'text-xs text-zinc-400',
  },
  light: {
    wrap:  'bg-white border border-gray-100 rounded-2xl p-4',
    title: 'text-base font-bold text-gray-900',
    sub:   'text-xs text-gray-500',
    card:  'bg-white border-gray-200 text-gray-700 hover:border-amber-200',
    on:    'bg-amber-50 border-amber-400 text-amber-900',
    note:  'text-xs text-gray-600',
  },
} as const

export default function MeetAgainPicker({ eventId, variant = 'light' }: { eventId: string; variant?: keyof typeof SKINS }) {
  const s = SKINS[variant]
  const [state,    setState]    = useState<State | null>(null)
  const [picked,   setPicked]   = useState<Set<string>>(new Set())
  const [saved,    setSaved]    = useState<Set<string>>(new Set())
  const [saving,   setSaving]   = useState(false)
  const [outcome,  setOutcome]  = useState<string | null>(null)

  useEffect(() => {
    fetch(`/app/api/events/${eventId}/meet-again`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then((d: State | null) => {
        if (!d) return
        setState(d)
        const initial = new Set(d.picked ?? [])
        setPicked(initial)
        setSaved(initial)
      })
      .catch(() => {})
  }, [eventId])

  if (!state?.eligible || !state.people?.length) return null
  const max = state.maxPicks ?? 8

  function toggle(id: string) {
    setOutcome(null)
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else if (next.size < max) next.add(id)
      else toast.message(`Pick up to ${max} people`)
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/app/api/events/${eventId}/meet-again`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pickedIds: [...picked] }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d.error ?? 'Could not save'); return }
      setSaved(new Set(picked))
      if (d.matches > 0) {
        setOutcome(d.matches === 1
          ? "🤝 It's mutual with one person — you're now connected. Check your notifications."
          : `🤝 It's mutual with ${d.matches} people — you're now connected. Check your notifications.`)
        // A new connection drops off the list; reload it.
        const fresh = await fetch(`/app/api/events/${eventId}/meet-again`, { credentials: 'include' }).then(r => r.ok ? r.json() : null).catch(() => null)
        if (fresh) {
          setState(fresh)
          const p = new Set<string>(fresh.picked ?? [])
          setPicked(p)
          setSaved(p)
        }
      } else {
        setOutcome(picked.size
          ? "Saved. If any of them pick you too, you'll both be told and connected."
          : 'Saved.')
      }
    } finally {
      setSaving(false)
    }
  }

  const dirty = picked.size !== saved.size || [...picked].some(id => !saved.has(id))

  return (
    <div className={`${s.wrap} space-y-3`}>
      <div>
        <p className={s.title}>Anyone you'd like to see again? <span className="font-normal opacity-60">(optional)</span></p>
        <p className={`${s.sub} mt-0.5`}>
          Private. Nobody sees who you picked — you're only connected when someone picks you too.
        </p>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {state.people.map(p => {
          const on = picked.has(p.id)
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => toggle(p.id)}
              aria-pressed={on}
              className={`relative flex flex-col items-center gap-1.5 px-1.5 py-2.5 rounded-xl border text-xs font-semibold transition-colors ${on ? s.on : s.card}`}
            >
              <UserAvatar user={p} size="lg" />
              <span className="w-full truncate text-center">{p.name}</span>
              {on && <span aria-hidden="true" className="absolute top-1 right-1.5 text-amber-500">✓</span>}
            </button>
          )
        })}
      </div>

      {outcome && !dirty ? (
        <p className={s.note}>{outcome}</p>
      ) : (
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving…' : picked.size ? `Save ${picked.size} pick${picked.size === 1 ? '' : 's'}` : saved.size ? 'Clear my picks' : 'Save'}
        </button>
      )}
    </div>
  )
}
