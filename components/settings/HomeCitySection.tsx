'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'

// Home-city picker — the "I moved" flow. Changing home re-scopes every
// feed, so it confirms before acting and spells out the semantics: the
// old city stays on your list as a joined city (clubs, RSVPs and history
// remain reachable), it doesn't vanish.

interface MemberCity {
  id:     string
  slug:   string
  name:   string
  status: string
  home:   boolean
}

export default function HomeCitySection() {
  const [cities,   setCities]   = useState<MemberCity[]>([])
  const [liveOptions, setLiveOptions] = useState<{ slug: string; name: string }[]>([])
  const [selected, setSelected] = useState('')
  const [saving,   setSaving]   = useState(false)
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/app/api/me/cities', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/app/api/cities').then(r => r.json()).catch(() => null),
    ]).then(([mine, all]) => {
      if (Array.isArray(mine?.cities)) setCities(mine.cities)
      if (Array.isArray(all)) setLiveOptions(all.filter((c: { status: string }) => c.status === 'live'))
    }).finally(() => setLoading(false))
  }, [])

  const home = cities.find(c => c.home)

  async function move() {
    const target = liveOptions.find(c => c.slug === selected)
    if (!target || !home) return
    const ok = await confirmToast(
      `Make ${target.name} your home city? Your feeds will show ${target.name}; ${home.name} stays on your list as a joined city.`,
      { confirmLabel: 'Move' },
    )
    if (!ok) return
    setSaving(true)
    try {
      const res  = await fetch('/app/api/me/cities', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: target.slug }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { toast.error(data?.error ?? 'Could not change home city'); return }
      setCities(Array.isArray(data?.cities) ? data.cities : [])
      setSelected('')
      toast.success(`${target.name} is your home city now`)
    } catch { toast.error('Could not change home city — check your connection') }
    finally { setSaving(false) }
  }

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="space-y-3">
      {home && (
        <p className="text-sm text-gray-700">
          <span aria-hidden="true">📍 </span>Your home city is <span className="font-bold">{home.name}</span>
          {cities.length > 1 && (
            <span className="text-gray-500"> · also in {cities.filter(c => !c.home).map(c => c.name).join(', ')}</span>
          )}
        </p>
      )}
      <div className="flex gap-2">
        <select
          value={selected}
          onChange={e => setSelected(e.target.value)}
          className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value="">Moved somewhere? Pick your new home city…</option>
          {liveOptions.filter(c => c.slug !== home?.slug).map(c => (
            <option key={c.slug} value={c.slug}>{c.name}</option>
          ))}
        </select>
        <button
          onClick={move}
          disabled={!selected || saving}
          className="shrink-0 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold disabled:opacity-40 transition-colors"
        >
          {saving ? 'Moving…' : 'Move'}
        </button>
      </div>
    </div>
  )
}
