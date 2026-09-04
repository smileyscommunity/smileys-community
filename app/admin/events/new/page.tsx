'use client'

import { toast } from 'sonner'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCityNeighborhoods } from '@/hooks/useCityNeighborhoods'
import ImageUpload from '@/components/ImageUpload'
import VibePicker from '@/components/VibePicker'
import { useAdminMemberSearch } from '@/hooks/useAdminMemberSearch'
import { EVENT_EMOJIS as EMOJIS } from '@/lib/eventEmojis'
import { countryName } from '@/lib/country'
import { useCurrentCity } from '@/hooks/useCurrentCity'
import { phonePlaceholder, dialCode } from '@/lib/country'
const inputCls = 'bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none px-3 py-2.5 w-full text-sm'


export default function NewEventPage() {
  const country = useCurrentCity()?.country
  const router = useRouter()
  const [clubs, setClubs] = useState<{ id: string; name: string; emoji: string; city?: { name: string; slug: string; country: string } }[]>([])
  const [hosts,      setHosts]      = useState<{ id: string; name: string }[]>([])
  const [hostSearch, setHostSearch] = useState('')

  const [form, setForm] = useState({
    title: '', date: '', time: '', location: '', neighborhood: '',
    address: '', clubId: '', hostId: '', description: '',
    totalSpots: '20', price: '', memberPrice: '', payTo: 'free', paymentContact: '', ticketUrl: '',
    emoji: '🎉', status: 'published',
    isPremium: false, membersOnly: false, limitedSpots: true, isFirstTimerFriendly: false, isRecurring: false,
    approvalRequired: false,
    genderBalance: false,
    maleQuota: '',
    femaleQuota: '',
    turkishMaleQuota: '',
    coverImage: '', coverImagePosition: 50, meetingUrl: '', whatsappUrl: '',
    minAge: '', maxAge: '',
    language: '', refundPolicy: '', registrationDeadline: '',
    endTime: '', lat: '', lng: '',
  })
  const [geocoding, setGeocoding] = useState(false)
  const [mapsUrl,   setMapsUrl]   = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [saving,      setSaving]      = useState(false)
  const [aiNotes,     setAiNotes]     = useState('')
  const [aiLoading,   setAiLoading]   = useState(false)
  const [error,       setError]       = useState('')
  const [repeat,      setRepeat]      = useState<'none' | 'weekly' | 'biweekly' | 'monthly'>('none')
  const [occurrences, setOccurrences] = useState(4)

  // Server-side search — the /api/admin/users list caps at the newest
  // 1000 users, so filtering a one-shot fetch client-side made early
  // members unfindable as hosts once the community grew past that.
  const { results: hostMatches } = useAdminMemberSearch(form.hostId ? '' : hostSearch, 1)

  useEffect(() => {
    fetch('/app/api/admin/clubs', { credentials: 'include' }).then(r => r.json()).then(d => setClubs(Array.isArray(d) ? d : []))
    fetch('/app/api/auth/me', { credentials: 'include' }).then(r => r.json()).then(me => {
      if (me?.id) { setForm(f => ({ ...f, hostId: me.id })); setHostSearch(me.name ?? '') }
    })
  }, [])

  useEffect(() => {
    if (!form.clubId) { setHosts([]); return }
    fetch(`/app/api/admin/clubs/${form.clubId}/memberships`, { credentials: 'include' })
      .then(r => r.json())
      .then(members => {
        const clubHosts = Array.isArray(members)
          ? members.filter((m: any) => m.role === 'host' && m.status === 'approved')
                   .map((m: any) => ({ id: m.userId, name: m.user.name }))
          : []
        setHosts(clubHosts)
        if (clubHosts.length > 0) setForm(f => ({ ...f, hostId: clubHosts[0].id }))
      })
  }, [form.clubId])

  // Neighborhoods follow the event's city (its parent club's), not the
  // viewer's — so a Bodrum event offers Bodrum areas. Falls back to the
  // viewer's own city until a club is chosen.
  const selectedClubCity = clubs.find(c => c.id === form.clubId)?.city?.slug
  const neighborhoods = useCityNeighborhoods(selectedClubCity)

  function set(key: string, value: string | boolean | number) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function writeWithAI() {
    setAiLoading(true)
    try {
      const club = clubs.find(c => c.id === form.clubId)
      const res = await fetch('/app/api/host/events/describe', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: form.title, location: form.location, vibes: [], clubName: club ? `${club.emoji} ${club.name}` : undefined, notes: aiNotes }),
      })
      if (!res.ok) { toast.error(res.status === 429 ? 'AI limit reached — try again in an hour' : `Write with AI failed (${res.status})`); return }
      const { description } = await res.json()
      set('description', description.split(/\n\n+/).map((p: string) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join(''))
    } catch { toast.error('Write with AI failed — check your connection') }
    finally { setAiLoading(false) }
  }

  async function suggestTags() {
    setAiLoading(true)
    try {
      const res = await fetch('/app/api/host/events/suggest-tags', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: form.title, description: form.description }),
      })
      if (!res.ok) { toast.error(res.status === 429 ? 'AI limit reached — try again in an hour' : `Suggest tags failed (${res.status})`); return }
      const { tagIds } = await res.json()
      if (!tagIds?.length) { toast.message('No matching tags — add more detail to the title or description'); return }
      const added = tagIds.filter((id: string) => !selectedTagIds.includes(id)).length
      setSelectedTagIds((prev: string[]) => [...new Set([...prev, ...tagIds])])
      toast.success(added ? `Added ${added} suggested tag${added === 1 ? '' : 's'}` : 'Suggestions match the tags already selected')
    } catch { toast.error('Suggest tags failed — check your connection') }
    finally { setAiLoading(false) }
  }

  async function geocodeAddress() {
    // Geocode within the event's OWN city (inherited from the parent club),
    // not a hardcoded Istanbul — otherwise a Bodrum address resolves to
    // Istanbul coordinates. Falls back to the default city only when no club
    // is picked yet.
    const geoClub = clubs.find(c => c.id === form.clubId)
    const cityHint = geoClub?.city ? `${geoClub.city.name}, ${countryName(geoClub.city.country)}` : ''
    const query = [form.location, form.address, form.neighborhood, cityHint].filter(Boolean).join(', ')
    setGeocoding(true)
    try {
      const res = await fetch(`/app/api/admin/geocode?q=${encodeURIComponent(query)}`, { credentials: 'include' })
      const data = await res.json()
      if (data[0]) {
        setForm(f => ({ ...f, lat: parseFloat(data[0].lat).toFixed(6), lng: parseFloat(data[0].lon).toFixed(6) }))
      } else {
        toast.error('No location found — try a more specific address')
      }
    } catch { toast.error('Geocoding failed') }
    finally { setGeocoding(false) }
  }

  async function parseMapsUrl(url: string) {
    const patterns = [
      /@(-?\d+\.\d+),(-?\d+\.\d+)/,
      /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
      /ll=(-?\d+\.\d+),(-?\d+\.\d+)/,
      /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    ]
    for (const re of patterns) {
      const m = url.match(re)
      if (m) {
        setForm(f => ({ ...f, lat: parseFloat(m[1]).toFixed(6), lng: parseFloat(m[2]).toFixed(6) }))
        setMapsUrl('')
        return
      }
    }
    setGeocoding(true)
    try {
      const res = await fetch(`/app/api/admin/geocode?url=${encodeURIComponent(url)}`, { credentials: 'include' })
      const data = await res.json()
      if (Array.isArray(data) && data[0]) {
        setForm(f => ({ ...f, lat: parseFloat(data[0].lat).toFixed(6), lng: parseFloat(data[0].lon).toFixed(6) }))
        setMapsUrl('')
        return
      }
    } finally { setGeocoding(false) }
    toast.error('Could not extract coordinates — try pasting a Google Maps link with a visible location pin')
  }

  function buildDates(): string[] {
    if (repeat === 'none' || !form.date) return [form.date]
    const days = repeat === 'weekly' ? 7 : repeat === 'biweekly' ? 14 : 30
    const dates: string[] = []
    const base = new Date(form.date)
    for (let i = 0; i < occurrences; i++) {
      const d = new Date(base)
      if (repeat === 'monthly') {
        d.setMonth(d.getMonth() + i)
      } else {
        d.setDate(d.getDate() + days * i)
      }
      dates.push(d.toISOString().split('T')[0])
    }
    return dates
  }

  async function handleSave() {
    setError('')
    const missing = []
    if (!form.title)        missing.push('Title')
    if (!form.date)         missing.push('Date')
    if (!form.time)         missing.push('Time')
    if (!form.location)     missing.push('Location')
    if (!form.neighborhood) missing.push('Neighborhood')
    if (!form.clubId)       missing.push('Club')
    if (!form.hostId)       missing.push('Host')
    if (form.payTo === 'buyonline' && !form.ticketUrl.trim()) missing.push('Ticket link')
    if (form.payTo !== 'free' && !(Number(form.price) > 0)) missing.push('Guest price (or choose Free)')
    if (missing.length) { setError(`Missing: ${missing.join(', ')}`); return }

    const dates = buildDates()
    const isSeriesCreate = repeat !== 'none' && dates.length > 1
    const seriesId = isSeriesCreate ? crypto.randomUUID() : undefined
    const payload = {
      ...form,
      // "Free" and "Buy online" are UI-only states on top of payTo's two
      // real values — Smileys still never touches the money for either, so
      // both map to payTo='venue' underneath.
      payTo:          form.payTo === 'free' || form.payTo === 'buyonline' ? 'venue' : form.payTo,
      ticketUrl:      form.payTo === 'buyonline' ? form.ticketUrl : '',
      paymentContact: form.payTo === 'smileys'   ? form.paymentContact : '',
      isRecurring: isSeriesCreate ? true : form.isRecurring,
      tagIds: selectedTagIds, vibes: [],
      seriesId,
      minAge:    form.minAge    ? parseInt(form.minAge)    : null,
      maxAge:    form.maxAge    ? parseInt(form.maxAge)    : null,
      coverImage:         form.coverImage   || null,
      coverImagePosition: form.coverImagePosition,
      meetingUrl:         form.meetingUrl   || null,
      whatsappUrl:  form.whatsappUrl  || null,
      address:      form.address      || null,
      language:     form.language     || null,
      refundPolicy: form.refundPolicy || null,
      registrationDeadline: form.registrationDeadline || null,
      clubId: form.clubId || null,
      hostId: form.hostId || null,
      lat:  form.lat  ? parseFloat(form.lat)  : null,
      lng:  form.lng  ? parseFloat(form.lng)  : null,
    }

    setSaving(true)
    try {
      for (const date of dates) {
        const res = await fetch('/app/api/admin/events', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, date }),
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error ?? 'Failed'); return }
      }

      // Auto-assign as club host + notify
      if (form.hostId && form.clubId) {
        await fetch(`/app/api/admin/clubs/${form.clubId}/hosts`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: form.hostId, role: 'host' }),
        })
      }

      router.push('/admin/events')
    } catch { setError('Something went wrong') }
    finally   { setSaving(false) }
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/events" className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-white text-2xl font-extrabold tracking-tight">Create event</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Fill in the details below</p>
        </div>
      </div>

      {error && <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-medium">{error}</div>}

      {/* Basic info */}
      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
        <h2 className="text-white font-bold mb-5">Basic info</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Event title *</label>
              <input type="text" value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Sunset Sailing Experience" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Club *</label>
              <select value={form.clubId} onChange={e => set('clubId', e.target.value)} className={inputCls}>
                <option value="">Select club</option>
                {clubs.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
              </select>
            </div>
            <div className="relative">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Host *</label>
              <input
                type="text"
                placeholder="Search member…"
                value={hostSearch}
                onChange={e => { setHostSearch(e.target.value); set('hostId', '') }}
                className={inputCls}
              />
              {hostSearch && !form.hostId && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                  {hostMatches.slice(0, 6).map(m => (
                    <button key={m.id} type="button"
                      onClick={() => { set('hostId', m.id); setHostSearch(m.name) }}
                      className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-amber-500/10 hover:text-amber-400 transition-colors">
                      {m.name}
                    </button>
                  ))}
                </div>
              )}
              {form.hostId && (
                <p className="text-xs text-green-400 mt-1">✓ {hostSearch}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="postponed">Postponed</option>
                <option value="cancelled">Cancelled</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Language</label>
              <input type="text" value={form.language} onChange={e => set('language', e.target.value)} placeholder="e.g. English, Turkish" className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Description</label>
              <div className="mb-2 bg-zinc-800/60 border border-zinc-700 rounded-xl p-3 space-y-2">
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Write with AI</p>
                <input type="text" value={aiNotes} onChange={e => setAiNotes(e.target.value)}
                  placeholder="Extra context for AI (optional)…"
                  className="w-full px-3 py-2 text-xs bg-zinc-900 border border-zinc-700 rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500" />
                <button type="button" onClick={writeWithAI} disabled={aiLoading || !form.title.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 transition-colors disabled:opacity-40">
                  {aiLoading ? '⏳ Writing…' : '✦ Generate description'}
                </button>
              </div>
              <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Describe the experience..." className={`${inputCls} resize-none`} />
            </div>
            <div className="col-span-2">
              <ImageUpload value={form.coverImage} onChange={url => set('coverImage', url)} folder="events"
                position={form.coverImagePosition} onPositionChange={pos => set('coverImagePosition', pos)} />
            </div>
          </div>
        </div>
      </section>

      {/* When & Where */}
      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
        <h2 className="text-white font-bold mb-5">When & Where</h2>
        <div className="space-y-4">
          {/* Date + Start time — always side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Date *</label>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={`${inputCls} admin-date-input`} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Start time *</label>
              <div className="flex items-center gap-1.5">
                <select value={form.time.split(':')[0] ?? ''} onChange={e => set('time', `${e.target.value}:${form.time.split(':')[1] ?? '00'}`)} className={inputCls}>
                  <option value="">HH</option>
                  {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <span className="text-zinc-400 font-bold">:</span>
                <select value={form.time.split(':')[1] ?? '00'} onChange={e => set('time', `${form.time.split(':')[0] ?? '00'}:${e.target.value}`)} className={inputCls}>
                  {['00', '15', '30', '45'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* End time + Registration deadline — always side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">End time</label>
              <div className="flex items-center gap-1.5">
                <select value={form.endTime.split(':')[0] ?? ''} onChange={e => set('endTime', `${e.target.value}:${form.endTime.split(':')[1] ?? '00'}`)} className={inputCls}>
                  <option value="">HH</option>
                  {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(h => <option key={h} value={h}>{h}</option>)}
                </select>
                <span className="text-zinc-400 font-bold">:</span>
                <select value={form.endTime.split(':')[1] ?? '00'} onChange={e => set('endTime', `${form.endTime.split(':')[0] ?? '00'}:${e.target.value}`)} className={inputCls}>
                  {['00', '15', '30', '45'].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Deadline</label>
              <input type="date" value={form.registrationDeadline} onChange={e => set('registrationDeadline', e.target.value)} className={`${inputCls} admin-date-input`} />
            </div>
          </div>

          {/* Repeat + Occurrences */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Repeat</label>
              <select value={repeat} onChange={e => setRepeat(e.target.value as typeof repeat)} className={inputCls}>
                <option value="none">Does not repeat</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            {repeat !== 'none' && (
              <div>
                <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Occurrences</label>
                <input type="number" min={2} max={52} value={occurrences} onChange={e => setOccurrences(parseInt(e.target.value) || 2)} className={inputCls} />
              </div>
            )}
          </div>
          {repeat !== 'none' && form.date && (
            <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
              Creates <strong>{occurrences} events</strong> — {buildDates().map(d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })).join(' · ')}
            </p>
          )}

          {/* Venue + Neighborhood */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Venue name *</label>
            <input type="text" value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Karaköy Lokantası" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Neighborhood *</label>
            <select value={form.neighborhood} onChange={e => set('neighborhood', e.target.value)} className={inputCls}>
              <option value="">Select neighborhood…</option>
              {neighborhoods.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Full address</label>
            <input type="text" value={form.address} onChange={e => set('address', e.target.value)} onBlur={() => { if (form.address.trim() && !form.lat) geocodeAddress() }} placeholder="e.g. Kemankeş Cad. No:10, Karaköy" className={inputCls} />
          </div>

          {/* Map coordinates */}
          <div className="col-span-2">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-zinc-400">Map coordinates <span className="font-normal text-zinc-500">(for map view)</span></label>
              <button
                type="button"
                onClick={geocodeAddress}
                disabled={geocoding || (!form.location && !form.address)}
                className="text-xs text-amber-400 hover:text-amber-300 disabled:opacity-40 transition-colors flex items-center gap-1"
              >
                {geocoding ? (
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                ) : (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                )}
                Look up from address
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="number" step="0.000001" value={form.lat} onChange={e => set('lat', e.target.value)} placeholder="Latitude (e.g. 41.0369)" className={inputCls} />
              <input type="number" step="0.000001" value={form.lng} onChange={e => set('lng', e.target.value)} placeholder="Longitude (e.g. 28.9772)" className={inputCls} />
            </div>
            {form.lat && form.lng && (
              <a
                href={`https://www.openstreetmap.org/?mlat=${form.lat}&mlon=${form.lng}&zoom=16`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-1.5 text-xs text-zinc-500 hover:text-amber-400 transition-colors"
              >
                ↗ Verify on OpenStreetMap
              </a>
            )}
          </div>

          {/* Google Maps URL paste */}
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Paste Google Maps link <span className="font-normal text-zinc-500">(extracts coordinates automatically)</span></label>
            <div className="flex gap-2">
              <input
                type="text"
                value={mapsUrl}
                onChange={e => setMapsUrl(e.target.value)}
                placeholder="https://maps.google.com/…"
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => parseMapsUrl(mapsUrl)}
                disabled={!mapsUrl.trim() || geocoding}
                className="px-4 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 text-xs font-semibold whitespace-nowrap disabled:opacity-40 transition-colors"
              >
                {geocoding ? 'Looking up…' : 'Extract'}
              </button>
            </div>
          </div>
        </div>
        </div>{/* end space-y-4 */}
      </section>

      {/* Capacity & pricing */}
      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
        <h2 className="text-white font-bold mb-5">Capacity & pricing</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Total spots</label>
            <input type="number" min="1" value={form.totalSpots} onChange={e => set('totalSpots', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Guest price</label>
            <input type="number" min="0" value={form.price} onChange={e => {
              const v = e.target.value
              set('price', v)
              // Keep the price and the payment-method selector in sync either
              // direction: typing a real price walks you off "Free"; clearing
              // it back to 0 walks you back on.
              if (Number(v) > 0 && form.payTo === 'free') set('payTo', 'venue')
              if (!(Number(v) > 0) && form.payTo !== 'free') set('payTo', 'free')
            }} placeholder="0 = free" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Member price</label>
            <input type="number" min="0" value={form.memberPrice} onChange={e => set('memberPrice', e.target.value)} placeholder="Optional" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Min age</label>
            <input type="number" min="0" value={form.minAge} onChange={e => set('minAge', e.target.value)} placeholder="Optional" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Max age</label>
            <input type="number" min="0" value={form.maxAge} onChange={e => set('maxAge', e.target.value)} placeholder="Optional" className={inputCls} />
          </div>
        </div>
        {/* Payment method — always 4 explicit options. "Free" and "Buy
            online" are UI-only states layered on top of payTo's two real
            values (Smileys never touches the money for either): "Free"
            maps to payTo='venue' with price forced to 0, "Buy online" maps
            to payTo='venue' with a required ticketUrl. Kept in sync with
            the price field above (see its onChange) and re-mapped back to
            real payTo/ticketUrl/paymentContact in handleSave's payload. */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">How do guests pay?</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { value: 'free',      label: 'Free',           hint: 'No payment required' },
              { value: 'venue',     label: 'Pay at venue',   hint: 'Guests pay when they arrive' },
              { value: 'buyonline', label: 'Buy online',     hint: 'External ticket link' },
              { value: 'smileys',   label: 'Pay to Smileys', hint: 'We collect & reconcile' },
            ].map(opt => (
              <button key={opt.value} type="button" onClick={() => {
                set('payTo', opt.value)
                if (opt.value === 'free') { set('price', '0'); set('memberPrice', '') }
              }}
                className={`text-left px-3 py-2.5 rounded-xl border transition-colors ${
                  form.payTo === opt.value
                    ? 'bg-amber-500/10 border-amber-500 text-white'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-600'
                }`}>
                <div className="text-sm font-semibold">{opt.label}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{opt.hint}</div>
              </button>
            ))}
          </div>
          {form.payTo === 'buyonline' && (
            <div className="mt-3">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Ticket link</label>
              <input type="text" value={form.ticketUrl} onChange={e => set('ticketUrl', e.target.value)}
                placeholder="https://…" className={inputCls} />
              <p className="text-xs text-zinc-600 mt-1">Shown as a “Buy tickets” button on the event page.</p>
            </div>
          )}
          {form.payTo === 'smileys' && (
            <div className="mt-3">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Payment contact (WhatsApp)</label>
              <input type="text" value={form.paymentContact} onChange={e => set('paymentContact', e.target.value)}
                placeholder={phonePlaceholder(country)} className={inputCls} />
            </div>
          )}
        </div>
        <div className="mb-4">
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Refund policy</label>
          <input type="text" value={form.refundPolicy} onChange={e => set('refundPolicy', e.target.value)} placeholder="e.g. Full refund up to 48h before" className={inputCls} />
        </div>
        <div className="mb-4">
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">WhatsApp group URL</label>
          <input type="text" value={form.whatsappUrl} onChange={e => set('whatsappUrl', e.target.value)} placeholder="https://chat.whatsapp.com/..." className={inputCls} />
        </div>
        <div className="flex flex-wrap gap-4">
          {[
            { key: 'limitedSpots', label: 'Limited spots'   },
            { key: 'isPremium',      label: '♛ Premium'            },
            { key: 'membersOnly',    label: '🔒 Members only'       },
            { key: 'isFirstTimerFriendly', label: '👋 First-timer friendly' },
            { key: 'isRecurring',    label: '🔁 Recurring'          },
            { key: 'approvalRequired', label: '✋ Approval required' },
            { key: 'genderBalance',  label: '⚖️ Gender balance'     },
          ].map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form[key as keyof typeof form] as boolean}
                onChange={e => set(key, e.target.checked)} className="w-4 h-4 rounded accent-amber-500" />
              <span className="text-sm text-zinc-300">{label}</span>
            </label>
          ))}
        </div>
        {form.genderBalance && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-zinc-300 shrink-0 w-32">♂ Male quota</label>
              <input
                type="number"
                min={1}
                max={form.totalSpots ? parseInt(form.totalSpots) - 1 : undefined}
                value={form.maleQuota}
                onChange={e => set('maleQuota', e.target.value)}
                placeholder={`Default: ${form.totalSpots ? Math.floor(parseInt(form.totalSpots) / 2) : '½ of spots'}`}
                className="w-32 bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 px-3 py-2 text-sm"
              />
              <span className="text-xs text-zinc-500">max males allowed</span>
            </div>
            {/* Female cap — null/empty = uncapped (preserves old behaviour).
                Set this to also cap the female side so the event balances
                instead of just protecting against male-dominance. */}
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-zinc-300 shrink-0 w-32">♀ Female quota</label>
              <input
                type="number"
                min={1}
                max={form.totalSpots ? parseInt(form.totalSpots) - 1 : undefined}
                value={form.femaleQuota}
                onChange={e => set('femaleQuota', e.target.value)}
                placeholder="Leave blank for uncapped"
                className="w-32 bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 px-3 py-2 text-sm"
              />
              <span className="text-xs text-zinc-500">max females allowed (blank = no cap)</span>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-zinc-300 shrink-0 w-32">🇹🇷 Turkish male</label>
              <input
                type="number"
                min={1}
                value={form.turkishMaleQuota}
                onChange={e => set('turkishMaleQuota', e.target.value)}
                placeholder="Leave blank for no sub-cap"
                className="w-32 bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 px-3 py-2 text-sm"
              />
              <span className="text-xs text-zinc-500">sub-cap on Turkish males specifically</span>
            </div>
          </div>
        )}
      </section>

      {/* Vibe */}
      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-bold">Vibe</h2>
          <button type="button" onClick={suggestTags} disabled={aiLoading || (!form.title && !form.description)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 transition-colors disabled:opacity-40">
            {aiLoading ? '⏳ Suggesting…' : '✦ Suggest tags'}
          </button>
        </div>
        <VibePicker selectedIds={selectedTagIds} onChange={setSelectedTagIds} />
      </section>

      {/* Emoji */}
      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5">
        <h2 className="text-white font-bold mb-5">Event emoji</h2>
        <div className="flex flex-wrap gap-3">
          {EMOJIS.map(e => (
            <button key={e} onClick={() => set('emoji', e)}
              className={`w-12 h-12 rounded-xl text-2xl flex items-center justify-center transition-all ${form.emoji === e ? 'bg-amber-500/10 ring-2 ring-amber-500 scale-110' : 'bg-zinc-800 hover:bg-zinc-700'}`}>
              {e}
            </button>
          ))}
        </div>
      </section>

      <div className="flex gap-3 justify-end pb-4">
        <Link href="/admin/events" className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-xl px-4 py-2 text-sm font-semibold">Cancel</Link>
        <button onClick={handleSave} disabled={saving} className="bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl px-8 py-2 text-sm disabled:opacity-50">
          {saving
            ? (repeat !== 'none' ? `Creating ${occurrences} events…` : 'Creating…')
            : (repeat !== 'none' ? `Create ${occurrences} events` : 'Create event')}
        </button>
      </div>
    </div>
  )
}
