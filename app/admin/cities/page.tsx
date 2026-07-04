'use client'

// /admin/cities — multi-city control. Create a city, launch its starter club
// lineup from the shared template catalog (lib/clubTemplates.ts), and grant
// city-host status. Clubs are per-city with city-scoped slugs; see
// lib/seedCityClubs.ts.

import { useState } from 'react'
import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'

interface CityHost { cityHostId: string; id: string; name: string; email: string }
interface City {
  id: string; name: string; slug: string; country: string; timezone: string
  currency: string; defaultLang: string; status: string; clubCount: number; hosts: CityHost[]
}

const card  = 'bg-zinc-900 border border-zinc-800 rounded-2xl p-5'
const input = 'w-full text-sm px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-700 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500'
const label = 'block text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1'

export default function AdminCitiesPage() {
  const { data, loading, error, retry, setData } = useAdminLoad<City[]>(
    '/app/api/admin/cities',
    (v): v is City[] => Array.isArray(v),
  )
  const cities = data ?? []

  // Create-city form
  const [name, setName]         = useState('')
  const [country, setCountry]   = useState('')
  const [timezone, setTimezone] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [lang, setLang]         = useState('en')
  const [creating, setCreating] = useState(false)

  // Per-city transient state
  const [launching, setLaunching] = useState<string | null>(null)
  const [hostEmail, setHostEmail] = useState<Record<string, string>>({})

  async function createCity() {
    if (!name.trim() || !country.trim() || !timezone.trim() || creating) return
    setCreating(true)
    try {
      const res = await fetch('/app/api/admin/cities', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, country, timezone, currency, defaultLang: lang }),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error ?? 'Could not create city'); return }
      toast.success(`Created ${d.name} (${d.slug})`)
      setName(''); setCountry(''); setTimezone('')
      retry() // refetch so the new city shows with counts/hosts
    } finally { setCreating(false) }
  }

  async function launchClubs(city: City) {
    if (launching) return
    if (!(await confirmToast(`Launch the starter club lineup for ${city.name}?`))) return
    setLaunching(city.id)
    try {
      const res = await fetch(`/app/api/admin/cities/${city.id}/launch-clubs`, { method: 'POST', credentials: 'include' })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error ?? 'Failed to launch clubs'); return }
      toast.success(`${city.name}: ${d.created} clubs created, ${d.skipped} already existed`)
      setData(prev => (prev ?? []).map(c => c.id === city.id ? { ...c, clubCount: c.clubCount + d.created } : c))
    } finally { setLaunching(null) }
  }

  async function addHost(city: City) {
    const email = (hostEmail[city.id] ?? '').trim()
    if (!email) return
    const res = await fetch(`/app/api/admin/cities/${city.id}/hosts`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    const d = await res.json()
    if (!res.ok) { toast.error(d.error ?? 'Could not add host'); return }
    toast.success(`${d.name} is now a city host`)
    setHostEmail(prev => ({ ...prev, [city.id]: '' }))
    setData(prev => (prev ?? []).map(c => c.id === city.id
      ? { ...c, hosts: [...c.hosts.filter(h => h.id !== d.id), d] }
      : c))
  }

  async function removeHost(city: City, host: CityHost) {
    if (!(await confirmToast(`Remove ${host.name} as a host of ${city.name}?`))) return
    const res = await fetch(`/app/api/admin/cities/${city.id}/hosts?cityHostId=${host.cityHostId}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) { toast.error('Could not remove host'); return }
    setData(prev => (prev ?? []).map(c => c.id === city.id
      ? { ...c, hosts: c.hosts.filter(h => h.cityHostId !== host.cityHostId) }
      : c))
  }

  if (error) return <LoadErrorBanner message={error} onRetry={retry} />

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Cities</h1>
        <p className="text-sm text-zinc-500 mt-1">Launch new cities, seed their starter clubs, and assign city hosts.</p>
      </div>

      {/* Create city */}
      <div className={card}>
        <h2 className="text-sm font-bold text-zinc-200 mb-4">Launch a new city</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={label}>City name</label>
            <input className={input} value={name} onChange={e => setName(e.target.value)} placeholder="Lisbon" />
          </div>
          <div>
            <label className={label}>Country</label>
            <input className={input} value={country} onChange={e => setCountry(e.target.value)} placeholder="Portugal" />
          </div>
          <div>
            <label className={label}>Timezone</label>
            <input className={input} value={timezone} onChange={e => setTimezone(e.target.value)} placeholder="Europe/Lisbon" />
          </div>
          <div>
            <label className={label}>Currency</label>
            <input className={input} value={currency} onChange={e => setCurrency(e.target.value)} placeholder="EUR" />
          </div>
          <div>
            <label className={label}>Default language</label>
            <input className={input} value={lang} onChange={e => setLang(e.target.value)} placeholder="en" />
          </div>
        </div>
        <button onClick={createCity} disabled={creating || !name.trim() || !country.trim() || !timezone.trim()}
          className="mt-4 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-40">
          {creating ? 'Creating…' : 'Create city'}
        </button>
      </div>

      {/* City list */}
      {loading ? (
        <div className={`${card} text-sm text-zinc-500`}>Loading cities…</div>
      ) : cities.length === 0 ? (
        <div className={`${card} text-sm text-zinc-500`}>No cities yet.</div>
      ) : (
        <div className="space-y-4">
          {cities.map(city => (
            <div key={city.id} className={card}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-white">{city.name}
                    <span className="ml-2 text-xs font-normal text-zinc-500">/{city.slug}</span>
                  </h3>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {city.country} · {city.timezone} · {city.currency} · {city.defaultLang}
                  </p>
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full bg-zinc-800 text-zinc-300">{city.status}</span>
              </div>

              <div className="flex items-center gap-3 mt-4">
                <span className="text-sm text-zinc-400"><strong className="text-zinc-200">{city.clubCount}</strong> clubs</span>
                <button onClick={() => launchClubs(city)} disabled={launching === city.id}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-amber-400 transition-colors disabled:opacity-40">
                  {launching === city.id ? 'Launching…' : 'Launch starter clubs'}
                </button>
              </div>

              {/* Hosts */}
              <div className="mt-4 pt-4 border-t border-zinc-800">
                <p className={label}>City hosts</p>
                {city.hosts.length > 0 ? (
                  <ul className="space-y-1.5 mb-3">
                    {city.hosts.map(h => (
                      <li key={h.cityHostId} className="flex items-center justify-between gap-2 text-sm">
                        <span className="text-zinc-300">{h.name} <span className="text-zinc-600">· {h.email}</span></span>
                        <button onClick={() => removeHost(city, h)} className="text-xs text-zinc-500 hover:text-red-400 transition-colors">Remove</button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-xs text-zinc-600 mb-3">No hosts yet.</p>}
                <div className="flex items-center gap-2">
                  <input className={input} placeholder="member@email.com"
                    value={hostEmail[city.id] ?? ''}
                    onChange={e => setHostEmail(prev => ({ ...prev, [city.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') addHost(city) }} />
                  <button onClick={() => addHost(city)}
                    className="shrink-0 text-xs font-semibold px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors">Add host</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
