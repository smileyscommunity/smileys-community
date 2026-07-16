'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import ImageUpload from '@/components/ImageUpload'
import RichTextEditor from '@/components/RichTextEditor'
import { ISTANBUL_NEIGHBORHOODS, todayIstanbul } from '@/lib/data'
import { useAuth } from '@/contexts/AuthContext'
import { EVENT_EMOJIS as EMOJIS } from '@/lib/eventEmojis'

const VIBES = ['Social', 'Chill', 'Active', 'Party', 'Networking', 'Learning', 'Food', 'Outdoor', 'Cultural']

const inputCls = 'w-full px-4 py-3 rounded-xl border border-zinc-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500 bg-zinc-800 placeholder-zinc-500'

export default function HostNewEventPage() {
  return <Suspense><HostNewEventForm /></Suspense>
}

function HostNewEventForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const neighborhoodParam = searchParams.get('neighborhood') ?? ''
  const { user } = useAuth()

  const [clubs,   setClubs]   = useState<{ id: string; name: string; emoji: string }[]>([])
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const [repeat,      setRepeat]      = useState<'none' | 'weekly' | 'biweekly' | 'monthly'>('none')
  const [occurrences, setOccurrences] = useState(4)
  const [aiNotes,     setAiNotes]     = useState('')
  const [aiLoading,   setAiLoading]   = useState(false)
  const [geocoding,   setGeocoding]   = useState(false)
  const [mapsUrl,     setMapsUrl]     = useState('')

  const [form, setForm] = useState({
    title:       '',
    clubId:      '',
    vibes:       [] as string[],
    intent:      'social' as 'social' | 'professional',
    emoji:       '🎉',
    date:        '',
    time:        '',
    location:     '',
    neighborhood: neighborhoodParam,
    address:      '',
    lat:          '',
    lng:          '',
    totalSpots:  '20',
    price:       '0',
    memberPrice: '',
    endTime:     '',
    whatsappUrl: '',
    ticketUrl:   '',
    description: '',
    coverImage:          '',
    coverImagePosition:  50,
  })

  useEffect(() => {
    fetch('/app/api/host/clubs', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => {
        const list = Array.isArray(d) ? d : []
        setClubs(list)
        if (list.length === 1) setForm(f => ({ ...f, clubId: list[0].id }))
      })

    const dupStr = sessionStorage.getItem('smileys_dup_event')
    if (dupStr) {
      try {
        const dup = JSON.parse(dupStr)
        sessionStorage.removeItem('smileys_dup_event')
        setForm(f => ({
          ...f,
          title:        dup.title        ? `${dup.title} (Copy)` : f.title,
          clubId:       dup.clubId       ?? f.clubId,
          date:         '',
          time:         dup.time         ?? f.time,
          location:     dup.location     ?? f.location,
          neighborhood: dup.neighborhood ?? f.neighborhood,
          address:      dup.address      ?? f.address,
          lat:          dup.lat  != null ? String(dup.lat)  : f.lat,
          lng:          dup.lng  != null ? String(dup.lng)  : f.lng,
          totalSpots:   dup.totalSpots   ? String(dup.totalSpots) : f.totalSpots,
          price:        dup.price        != null ? String(dup.price) : f.price,
          memberPrice:  dup.memberPrice  != null ? String(dup.memberPrice) : f.memberPrice,
          description:  dup.description  ?? f.description,
          coverImage:   dup.coverImage   ?? f.coverImage,
        }))
      } catch {}
    }
  }, [])

  async function geocodeAddress() {
    const query = [form.location, form.address, 'Istanbul, Turkey'].filter(Boolean).join(', ')
    setGeocoding(true)
    try {
      const res  = await fetch(`/app/api/admin/geocode?q=${encodeURIComponent(query)}`, { credentials: 'include' })
      const data = await res.json()
      if (Array.isArray(data) && data[0]) {
        setForm(f => ({ ...f, lat: parseFloat(data[0].lat).toFixed(6), lng: parseFloat(data[0].lon).toFixed(6) }))
      } else {
        alert('No location found — paste a Google Maps link below instead')
      }
    } catch { alert('Geocoding failed — paste a Google Maps link below instead') }
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
    // Send to server for redirect resolution (handles maps.app.goo.gl and place names)
    setGeocoding(true)
    try {
      const res = await fetch(`/app/api/admin/geocode?url=${encodeURIComponent(url)}`, { credentials: 'include' })
      const data = await res.json()
      if (Array.isArray(data) && data[0]) {
        setForm(f => ({ ...f, lat: parseFloat(data[0].lat).toFixed(6), lng: parseFloat(data[0].lon).toFixed(6) }))
        setMapsUrl('')
        return
      }
    } finally {
      setGeocoding(false)
    }
    alert('Could not extract coordinates — try pasting a Google Maps link with a visible location pin')
  }

  function toggleVibe(v: string) {
    setForm(f => ({
      ...f,
      vibes: f.vibes.includes(v) ? f.vibes.filter(x => x !== v) : [...f.vibes, v],
    }))
  }

  function buildDates(): string[] {
    if (repeat === 'none' || !form.date) return [form.date]
    const days = repeat === 'weekly' ? 7 : repeat === 'biweekly' ? 14 : 0
    const dates: string[] = []
    const base = new Date(form.date)
    for (let i = 0; i < occurrences; i++) {
      const d = new Date(base)
      if (repeat === 'monthly') d.setMonth(d.getMonth() + i)
      else d.setDate(d.getDate() + days * i)
      dates.push(d.toISOString().split('T')[0])
    }
    return dates
  }

  async function writeWithAI() {
    setAiLoading(true)
    const club = clubs.find(c => c.id === form.clubId)
    const res = await fetch('/app/api/host/events/describe', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title:    form.title,
        location: form.location,
        vibes:    form.vibes,
        clubName: club ? `${club.emoji} ${club.name}` : undefined,
        notes:    aiNotes,
      }),
    })
    if (res.ok) {
      const { description } = await res.json()
      const html = description.split(/\n\n+/).map((p: string) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
      setForm(f => ({ ...f, description: html }))
    }
    setAiLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!form.clubId)             { setError('Please select a club for this event'); return }
    if (!form.title.trim())       { setError('Title is required'); return }
    if (!form.date)               { setError('Date is required'); return }
    if (form.date < todayIstanbul()) { setError('Event date cannot be in the past'); return }
    if (!form.time)               { setError('Time is required'); return }
    if (!form.location.trim())    { setError('Location name is required'); return }
    if (!form.neighborhood)       { setError('Neighborhood is required'); return }
    if (!form.address.trim())     { setError('Full address is required'); return }
    if (!form.description.trim()) { setError('Description is required'); return }
    if (!form.coverImage)         { setError('Cover image is required'); return }

    const hostId = user?.id
    if (!hostId) { setError('Session expired — please refresh'); return }

    setSaving(true)
    try {
      const dates = buildDates()
      const isSeriesCreate = repeat !== 'none' && dates.length > 1
      const seriesId = isSeriesCreate ? crypto.randomUUID() : undefined
      const payload = {
        title:        form.title.trim(),
        clubId:       form.clubId || undefined,
        vibes:        form.vibes,
        // Event Goal — was collected by the form but never sent, so
        // every host event silently defaulted to 'social'.
        intent:       form.intent,
        time:         form.time,
        endTime:      form.endTime || undefined,
        whatsappUrl:  form.whatsappUrl.trim() || undefined,
        ticketUrl:    form.ticketUrl.trim() || undefined,
        location:     form.location.trim(),
        neighborhood: form.neighborhood,
        address:      form.address.trim(),
        totalSpots:   parseInt(form.totalSpots) || 20,
        description:  form.description.trim(),
        coverImage:         form.coverImage,
        coverImagePosition: form.coverImagePosition,
        hostId,
        price:        parseInt(form.price) || 0,
        memberPrice:  form.memberPrice ? parseInt(form.memberPrice) : undefined,
        emoji:        form.emoji,
        limitedSpots: true,
        isRecurring:  isSeriesCreate,
        seriesId,
        lat:  form.lat  ? parseFloat(form.lat)  : null,
        lng:  form.lng  ? parseFloat(form.lng)  : null,
      }

      for (const date of dates) {
        const res = await fetch('/app/api/admin/events', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, date }),
        })
        const data = await res.json()
        if (!res.ok) { setError(data.error ?? 'Failed to create event'); return }
      }

      // Auto-assign as club host if club selected
      if (form.clubId) {
        await fetch(`/app/api/admin/clubs/${form.clubId}/hosts`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: hostId, role: 'host' }),
        })
      }

      router.push('/host/events')
    } catch {
      setError('Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-lg">
      <h1 className="text-2xl font-bold text-white mb-6">Create Event</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm px-4 py-3 rounded-xl">{error}</div>
        )}

        {/* Title */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Title *</label>
          <input
            type="text"
            placeholder="Event name…"
            value={form.title}
            onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            required
            className={inputCls}
          />
        </div>

        {/* Club */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Club</label>
          <select
            value={form.clubId}
            onChange={e => setForm(f => ({ ...f, clubId: e.target.value }))}
            className={inputCls}
          >
            <option value="">None</option>
            {clubs.map(c => (
              <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
            ))}
          </select>
        </div>

        {/* Intent */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2">Event Goal</label>
          <div className="flex gap-2">
            {[
              { id: 'social', label: '🥨 Social', desc: 'Chill, party, hobbies' },
              { id: 'professional', label: '🤝 Networking', desc: 'Work, business, career' },
            ].map(opt => (
              <button key={opt.id} type="button" onClick={() => setForm(f => ({ ...f, intent: opt.id as any }))}
                className={`flex-1 p-3 rounded-xl border transition-all text-left ${
                  form.intent === opt.id
                    ? 'bg-amber-500/10 border-amber-500 text-amber-500'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                }`}>
                <p className="text-sm font-bold">{opt.label}</p>
                <p className="text-[10px] opacity-60 mt-0.5">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Vibes */}
        <div>

          <label className="block text-xs font-semibold text-zinc-400 mb-2">Vibe</label>
          <div className="flex flex-wrap gap-2">
            {VIBES.map(v => (
              <button
                key={v}
                type="button"
                onClick={() => toggleVibe(v)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  form.vibes.includes(v)
                    ? 'bg-amber-500 text-white'
                    : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Date & Time */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Date *</label>
            <input
              type="date"
              value={form.date}
              min={todayIstanbul()}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              required
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Time *</label>
            <div className="flex items-center gap-1.5">
              <select
                value={form.time.split(':')[0] ?? ''}
                onChange={e => setForm(f => ({ ...f, time: `${e.target.value}:${f.time.split(':')[1] ?? '00'}` }))}
                required
                className={inputCls}
              >
                <option value="">HH</option>
                {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <span className="text-zinc-400 font-bold">:</span>
              <select
                value={form.time.split(':')[1] ?? ''}
                onChange={e => setForm(f => ({ ...f, time: `${f.time.split(':')[0] ?? '00'}:${e.target.value}` }))}
                className={inputCls}
              >
                {['00', '15', '30', '45'].map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">End time</label>
            <input type="text" value={form.endTime}
              onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))}
              placeholder="e.g. 22:00 (optional)" className={inputCls} />
          </div>
        </div>

        {/* Recurring */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2">Repeat</label>
          <div className="flex flex-wrap gap-2">
            {(['none', 'weekly', 'biweekly', 'monthly'] as const).map(r => (
              <button key={r} type="button" onClick={() => setRepeat(r)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  repeat === r ? 'bg-amber-500 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}>
                {r === 'none' ? 'No repeat' : r === 'weekly' ? 'Weekly' : r === 'biweekly' ? 'Every 2 weeks' : 'Monthly'}
              </button>
            ))}
          </div>
          {repeat !== 'none' && (
            <div className="mt-3 flex items-center gap-3">
              <label className="text-xs text-zinc-400 shrink-0">Occurrences</label>
              <input
                type="number"
                min={2}
                max={52}
                value={occurrences}
                onChange={e => setOccurrences(parseInt(e.target.value) || 2)}
                className="w-20 px-3 py-2 bg-zinc-800 border border-zinc-700 text-white text-sm rounded-xl focus:outline-none focus:border-amber-500"
              />
              <span className="text-xs text-zinc-500">events will be created</span>
            </div>
          )}
        </div>

        {/* Location */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Venue name *</label>
          <input
            type="text"
            placeholder="e.g. Salon İKSV"
            value={form.location}
            onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
            required
            className={inputCls}
          />
        </div>

        {/* Neighborhood */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Neighborhood *</label>
          <select
            value={form.neighborhood}
            onChange={e => setForm(f => ({ ...f, neighborhood: e.target.value }))}
            className={inputCls}
          >
            <option value="">Select neighborhood…</option>
            {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        {/* Full address */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Full address *</label>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="e.g. Sadi Konuralp Cad. No:5, Şişhane"
              value={form.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              onBlur={() => { if (form.address.trim() && !form.lat) geocodeAddress() }}
              className={`${inputCls} flex-1`}
            />
            <button type="button" onClick={geocodeAddress} disabled={geocoding || (!form.location && !form.address)}
              className="shrink-0 px-3 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold disabled:opacity-40 transition-colors whitespace-nowrap">
              {geocoding ? '…' : '📍 Look up'}
            </button>
          </div>
          {form.lat && form.lng && (
            <p className="text-xs text-green-400 mt-1.5">✓ Location set ({parseFloat(form.lat).toFixed(4)}, {parseFloat(form.lng).toFixed(4)})</p>
          )}
        </div>

        {/* Google Maps URL */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
            Or paste a Google Maps link
            <span className="font-normal text-zinc-500 ml-1">(open Maps → Share → Copy link)</span>
          </label>
          <div className="flex gap-2">
            <input type="text" value={mapsUrl} onChange={e => setMapsUrl(e.target.value)}
              placeholder="https://maps.google.com/..." className={`${inputCls} flex-1`} />
            <button type="button" onClick={() => parseMapsUrl(mapsUrl)} disabled={!mapsUrl.trim()}
              className="shrink-0 px-3 py-2.5 rounded-xl bg-zinc-600 hover:bg-zinc-500 text-white text-xs font-semibold disabled:opacity-40 transition-colors whitespace-nowrap">
              Extract
            </button>
          </div>
        </div>

        {/* Capacity */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Capacity</label>
          <input
            type="number"
            min="1"
            value={form.totalSpots}
            onChange={e => setForm(f => ({ ...f, totalSpots: e.target.value }))}
            className={inputCls}
          />
        </div>

        {/* Pricing */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Guest price (₺)</label>
            <input type="number" min="0" value={form.price}
              onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
              placeholder="0 = Free" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Member price (₺)</label>
            <input type="number" min="0" value={form.memberPrice}
              onChange={e => setForm(f => ({ ...f, memberPrice: e.target.value }))}
              placeholder="Optional" className={inputCls} />
          </div>
        </div>

        {/* Links — both optional. Ticket link renders as a 🎟 Buy
            tickets button on the event page; the WhatsApp group is
            shown to registered members. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Ticket link (external)</label>
            <input type="text" value={form.ticketUrl}
              onChange={e => setForm(f => ({ ...f, ticketUrl: e.target.value }))}
              placeholder="https://… (optional)" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">WhatsApp group URL</label>
            <input type="text" value={form.whatsappUrl}
              onChange={e => setForm(f => ({ ...f, whatsappUrl: e.target.value }))}
              placeholder="https://chat.whatsapp.com/… (optional)" className={inputCls} />
          </div>
        </div>

        {/* Cover image */}
        <ImageUpload
          value={form.coverImage}
          onChange={url => setForm(f => ({ ...f, coverImage: url }))}
          label="Cover image *"
          folder="events"
          position={form.coverImagePosition}
          onPositionChange={pos => setForm(f => ({ ...f, coverImagePosition: pos }))}
        />

        {/* Description */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-zinc-400">Description *</label>
          </div>

          {/* AI hint box */}
          <div className="mb-2 bg-zinc-800/60 border border-zinc-700 rounded-xl p-3 space-y-2">
            <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Write with AI</p>
            <input
              type="text"
              value={aiNotes}
              onChange={e => setAiNotes(e.target.value)}
              placeholder="Any extra context? (e.g. bring a picnic blanket, beginner-friendly, rooftop venue…)"
              className="w-full px-3 py-2 text-xs bg-zinc-900 border border-zinc-700 rounded-lg text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <button
              type="button"
              onClick={writeWithAI}
              disabled={aiLoading || !form.title.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 transition-colors disabled:opacity-40"
            >
              {aiLoading ? '⏳ Writing…' : '✦ Generate description'}
            </button>
          </div>

          <RichTextEditor value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Tell people what this event is about…" />
        </div>

        {/* Emoji */}
        <div>
          <label className="block text-xs font-semibold text-zinc-400 mb-2">Event emoji</label>
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map(e => (
              <button key={e} type="button" onClick={() => setForm(f => ({ ...f, emoji: e }))}
                className={`w-11 h-11 rounded-xl text-2xl flex items-center justify-center transition-all ${
                  form.emoji === e ? 'bg-amber-500/20 ring-2 ring-amber-500 scale-110' : 'bg-zinc-800 hover:bg-zinc-700'
                }`}>
                {e}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl transition-colors disabled:opacity-50 text-sm"
        >
          {saving ? 'Creating…' : repeat !== 'none' ? `Create ${occurrences} Events` : 'Create Event'}
        </button>
      </form>
    </div>
  )
}
