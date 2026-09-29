'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
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

// The move ends in a full page load, so anything worth saying afterwards has
// to outlive this component. One sessionStorage handoff, read and cleared on
// the way back in.
const MOVED_KEY = 'smileys_home_city_moved'

interface MovedNotice { name: string; neighborhoodCleared: boolean }

function takeMovedNotice(): MovedNotice | null {
  try {
    const raw = sessionStorage.getItem(MOVED_KEY)
    if (!raw) return null
    sessionStorage.removeItem(MOVED_KEY)
    const d = JSON.parse(raw)
    return typeof d?.name === 'string' ? { name: d.name, neighborhoodCleared: !!d.neighborhoodCleared } : null
  } catch { return null }
}

// Staff can't move themselves: their home city is the city they moderate
// (lib/cityMembership), so an admin does it from the member's admin page.
// Said here rather than after the confirm dialog, which is where the server's
// refusal used to turn up.
export default function HomeCitySection({ staff = false }: { staff?: boolean }) {
  const [cities,   setCities]   = useState<MemberCity[]>([])
  const [liveOptions, setLiveOptions] = useState<{ slug: string; name: string }[]>([])
  const [selected, setSelected] = useState('')
  const [saving,   setSaving]   = useState(false)
  const [loading,  setLoading]  = useState(true)
  const [moved,    setMoved]    = useState<MovedNotice | null>(null)

  useEffect(() => { setMoved(takeMovedNotice()) }, [])

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
      `Make ${target.name} your home city? Your feeds will show ${target.name}; ${home.name} stays on your list as a joined city. `
      + `The neighbourhood on your profile is cleared — ${home.name}'s neighbourhoods don't exist in ${target.name} — so pick a new one afterwards.`,
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
      if (!res.ok) { toast.error(data?.error ?? 'Could not change home city'); setSaving(false); return }
      try {
        sessionStorage.setItem(MOVED_KEY, JSON.stringify({ name: target.name, neighborhoodCleared: !!data?.neighborhoodCleared }))
      } catch {}
      // A FULL load, like CitiesMenu.switchTo: the city's name, timezone and
      // every feed cached for this page load resolve from the old city
      // otherwise, so half the page kept saying the city they just left.
      // `saving` stays true — assign() only starts the navigation, and the
      // document load throws this component's state away anyway.
      window.location.assign('/app/settings')
    } catch {
      toast.error('Could not change home city — check your connection')
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="space-y-3">
      {moved && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <p className="text-xs text-amber-900 leading-relaxed">
            {moved.name} is your home city now.
            {moved.neighborhoodCleared
              ? <> Your old neighbourhood was cleared — <Link href="/profile" className="font-semibold underline">pick a new one on your profile</Link>.</>
              : <> Set a neighbourhood on <Link href="/profile" className="font-semibold underline">your profile</Link> so people nearby can find you.</>}
          </p>
        </div>
      )}
      {home && (
        <p className="text-sm text-gray-700">
          <span aria-hidden="true">📍 </span>Your home city is <span className="font-bold">{home.name}</span>
          {cities.length > 1 && (
            <span className="text-gray-500"> · also in {cities.filter(c => !c.home).map(c => c.name).join(', ')}</span>
          )}
        </p>
      )}
      {staff ? (
        <p className="text-xs text-gray-500">
          Your home city is also the city you moderate, so an admin changes it for you — ask the team.
        </p>
      ) : (
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
      )}
    </div>
  )
}
