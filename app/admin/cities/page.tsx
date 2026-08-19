'use client'

// /admin/cities — multi-city control. Create a city, launch its starter club
// lineup from the shared template catalog (lib/clubTemplates.ts), and grant
// city-host status. Clubs are per-city with city-scoped slugs; see
// lib/seedCityClubs.ts.

import { useState } from 'react'
import { toast } from 'sonner'
import { confirmToast } from '@/lib/confirmToast'
import { downscaleImage } from '@/lib/image-resize'
import { resolveImageUrl } from '@/lib/data'
import { useAdminLoad } from '@/lib/admin/useAdminLoad'
import LoadErrorBanner from '@/components/admin/LoadErrorBanner'
import { CITY_STATUS, CITY_STATUS_META, CITY_STATUS_VALUES } from '@/lib/cityStatus'
import { CITY_MATURITY, type CityMaturity } from '@/lib/cityMaturity'

interface CityHost { cityHostId: string; id: string; name: string; email: string }
interface City {
  id: string; name: string; slug: string; country: string; timezone: string
  currency: string; defaultLang: string; status: string; clubCount: number; hosts: CityHost[]
  neighborhoodCount: number
  // Derived from the same counts the go-live gate checks — the panel shows
  // the path to live instead of the gate's rejection being the first signal.
  readiness: { clubs: boolean; hosts: boolean; neighborhoods: boolean }
  // Derived from live data (lib/cityMaturity) — the API computes it for live
  // cities only; null otherwise. Deliberately not editable anywhere.
  maturity: CityMaturity | null
  tagline: string | null; description: string | null; heroImage: string | null
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
  const [hoodInput, setHoodInput] = useState<Record<string, string>>({})
  const [hoodBusy,  setHoodBusy]  = useState<string | null>(null)
  const [saving, setSaving]       = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  // Shopfront copy is edited inline per city; drafts live here until saved so
  // typing doesn't refetch the list on every keystroke.
  const [draft, setDraft] = useState<Record<string, { tagline: string; description: string }>>({})

  function draftFor(city: City) {
    return draft[city.id] ?? { tagline: city.tagline ?? '', description: city.description ?? '' }
  }

  // One PATCH for every city edit — status changes and copy alike. The server
  // refuses to take a city live without clubs and hosts, so the error path
  // matters as much as the success one here.
  async function patchCity(city: City, body: Record<string, unknown>, successMsg: string) {
    if (saving) return
    setSaving(city.id)
    try {
      const res = await fetch(`/app/api/admin/cities/${city.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) { toast.error(d.error ?? 'Could not update city'); return }
      toast.success(successMsg)
      setData(prev => (prev ?? []).map(c => c.id === city.id ? { ...c, ...d.city } : c))
    } finally { setSaving(null) }
  }

  // Hero images go to the shared uploads store via /api/upload (folder 'general',
  // which admins may write). Downscaled client-side first — a phone photo is
  // several MB and this one renders as a wide banner, not at original size.
  // The PATCH validates the returned path, so a hand-edited URL can't point the
  // hero at an arbitrary file.
  async function uploadHero(city: City, file: File) {
    if (uploading) return
    setUploading(city.id)
    try {
      const fd = new FormData()
      fd.append('file', await downscaleImage(file))
      fd.append('folder', 'general')
      const res = await fetch('/app/api/upload', { method: 'POST', credentials: 'include', body: fd })
      const d   = await res.json()
      if (!res.ok || !d.url) { toast.error(d.error ?? 'Upload failed'); return }
      await patchCity(city, { heroImage: d.url }, `Hero image set for ${city.name}`)
    } catch {
      toast.error('Upload failed')
    } finally { setUploading(null) }
  }

  async function setStatus(city: City, status: string) {
    if (status === city.status) return
    if (status === CITY_STATUS.Live) {
      const ok = await confirmToast(`Take ${city.name} live? It appears on the homepage, in the city menu and at /${city.slug} immediately.`)
      if (!ok) return
    }
    await patchCity(city, { status }, `${city.name} → ${CITY_STATUS_META[status as keyof typeof CITY_STATUS_META]?.label ?? status}`)
  }

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

  async function addNeighborhoods(city: City) {
    const raw = (hoodInput[city.id] ?? '').trim()
    if (!raw) return
    // Accept comma- or newline-separated paste — whichever the admin has.
    const names = raw.split(/[\n,]/).map(s => s.trim()).filter(Boolean)
    if (names.length === 0) return
    setHoodBusy(city.id)
    try {
      const res = await fetch(`/app/api/admin/cities/${city.id}/neighborhoods`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(d?.error ?? 'Could not add neighborhoods'); return }
      toast.success(`${d.added} added${d.skipped ? ` · ${d.skipped} already present` : ''}`)
      setHoodInput(prev => ({ ...prev, [city.id]: '' }))
      setData(prev => (prev ?? []).map(c => c.id === city.id
        ? { ...c, neighborhoodCount: d.total, readiness: { ...c.readiness, neighborhoods: d.total > 0 } }
        : c))
    } finally { setHoodBusy(null) }
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
            <input className={input} value={country} onChange={e => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="PT (ISO code)" />
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
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <select
                    value={city.status}
                    onChange={e => setStatus(city, e.target.value)}
                    disabled={saving === city.id}
                    aria-label={`Status for ${city.name}`}
                    className="text-[11px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full bg-zinc-800 text-zinc-200 border border-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-40"
                  >
                    {CITY_STATUS_VALUES.map(v => (
                      <option key={v} value={v}>{CITY_STATUS_META[v].label}</option>
                    ))}
                  </select>
                  {city.status === CITY_STATUS.Live && (
                    <a href={`/app/${city.slug}`} target="_blank" rel="noreferrer"
                       className="text-[11px] text-amber-400 hover:underline">View public page ↗</a>
                  )}
                </div>
              </div>

              {/* Public shopfront copy — what the city card and /<slug> page show. */}
              <div className="mt-4 pt-4 border-t border-zinc-800 space-y-3">
                <div>
                  <label className={label} htmlFor={`tagline-${city.id}`}>Card tagline</label>
                  <input
                    id={`tagline-${city.id}`}
                    className={input}
                    maxLength={160}
                    placeholder={`Your international social life in ${city.name}.`}
                    value={draftFor(city).tagline}
                    onChange={e => setDraft(prev => ({ ...prev, [city.id]: { ...draftFor(city), tagline: e.target.value } }))}
                  />
                </div>
                <div>
                  <label className={label} htmlFor={`desc-${city.id}`}>Page description</label>
                  <textarea
                    id={`desc-${city.id}`}
                    className={`${input} min-h-[72px]`}
                    maxLength={1000}
                    placeholder="Shown on the city page hero and in search results."
                    value={draftFor(city).description}
                    onChange={e => setDraft(prev => ({ ...prev, [city.id]: { ...draftFor(city), description: e.target.value } }))}
                  />
                </div>
                <button
                  onClick={() => patchCity(city, draftFor(city), `Saved ${city.name}`)}
                  disabled={saving === city.id}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors disabled:opacity-40">
                  {saving === city.id ? 'Saving…' : 'Save copy'}
                </button>

                {/* Hero image — the photo behind the city card on the homepage
                    and at the top of /<slug>. Without one both fall back to a
                    shared image, which is fine for one city and increasingly
                    odd as cities are added. */}
                <div className="pt-3 border-t border-zinc-800">
                  <p className={label}>Hero image</p>
                  <div className="flex items-start gap-4">
                    <div className="w-40 shrink-0 aspect-[3/2] rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800 flex items-center justify-center">
                      {city.heroImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={resolveImageUrl(city.heroImage)} alt={`${city.name} hero`} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[11px] text-zinc-600 text-center px-2">No image — falls back to the shared photo</span>
                      )}
                    </div>
                    <div className="flex-1 space-y-2">
                      <label className={`inline-block text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${uploading === city.id ? 'bg-zinc-800 text-zinc-500' : 'bg-zinc-800 hover:bg-zinc-700 text-amber-400 cursor-pointer'}`}>
                        {uploading === city.id ? 'Uploading…' : city.heroImage ? 'Replace image' : 'Upload image'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          disabled={uploading === city.id}
                          onChange={e => {
                            const f = e.target.files?.[0]
                            // Reset the input so picking the same file twice
                            // still fires a change event.
                            e.target.value = ''
                            if (f) uploadHero(city, f)
                          }}
                        />
                      </label>
                      {city.heroImage && (
                        <button
                          onClick={async () => {
                            if (await confirmToast(`Remove ${city.name}'s hero image?`)) {
                              patchCity(city, { heroImage: null }, `Hero image removed for ${city.name}`)
                            }
                          }}
                          disabled={saving === city.id}
                          className="block text-xs text-zinc-500 hover:text-red-400 transition-colors disabled:opacity-40">
                          Remove
                        </button>
                      )}
                      <p className="text-[11px] text-zinc-600 leading-relaxed">
                        Landscape works best — it renders wide on the city card and full-bleed on the city page.
                        Large photos are downscaled before upload.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 mt-4">
                {/* Ops signal, not a setting: derived from members/events/hosts/
                    hangouts. A live city sitting in "seeding" needs a person's
                    attention — there is nothing to click here on purpose. */}
                {city.maturity && (
                  <span
                    title="Derived from live data — members, upcoming events, hosted clubs, member activity. Not editable."
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                      city.maturity === CITY_MATURITY.SelfSustaining ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                      : city.maturity === CITY_MATURITY.Forming      ? 'bg-sky-500/15 text-sky-400 border border-sky-500/25'
                      :                                                'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                    }`}>
                    {city.maturity === CITY_MATURITY.SelfSustaining ? 'self-sustaining' : city.maturity}
                  </span>
                )}
                <span className="text-sm text-zinc-400"><strong className="text-zinc-200">{city.clubCount}</strong> clubs</span>
                {/* Launch readiness — mirrors the go-live gate's three counts.
                    Hidden once live: the gate has already been passed. */}
                {city.status !== 'live' && (() => {
                  const items = [
                    { ok: city.readiness.clubs,         label: 'clubs' },
                    { ok: city.readiness.hosts,         label: 'host' },
                    { ok: city.readiness.neighborhoods, label: 'neighborhoods' },
                  ]
                  const done = items.filter(i => i.ok).length
                  return (
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full border ${
                      done === 3 ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                                 : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                    }`} title="What the go-live gate checks">
                      {done}/3 to launch
                      {items.map(i => (
                        <span key={i.label} className={i.ok ? 'text-emerald-400' : 'text-zinc-600'}>
                          {i.ok ? '✓' : '✗'} {i.label}
                        </span>
                      ))}
                    </span>
                  )
                })()}
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

              {/* Neighborhoods — the last launch step that used to need a
                  developer-run seed script. Paste names (comma or newline
                  separated); slug and defaults are derived. Enrichment
                  (emoji, vibe, coords) can come later per city. */}
              <div className="mt-4 pt-4 border-t border-zinc-800">
                <p className={label}>Neighborhoods <span className="normal-case font-normal text-zinc-600">· {city.neighborhoodCount} active</span></p>
                <div className="flex items-start gap-2">
                  <textarea className={`${input} min-h-[38px] resize-y`} rows={1}
                    placeholder="Paste names — comma or newline separated"
                    value={hoodInput[city.id] ?? ''}
                    onChange={e => setHoodInput(prev => ({ ...prev, [city.id]: e.target.value }))} />
                  <button onClick={() => addNeighborhoods(city)} disabled={hoodBusy === city.id}
                    className="shrink-0 text-xs font-semibold px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors disabled:opacity-40">
                    {hoodBusy === city.id ? 'Adding…' : 'Add'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
