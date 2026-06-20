'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ISTANBUL_NEIGHBORHOODS, todayIstanbul } from '@/lib/data'
import ImageUpload from '@/components/ImageUpload'
import VibePicker from '@/components/VibePicker'
import RichTextEditor from '@/components/RichTextEditor'
const EMOJIS = [
  '⛵', '🍽️', '💬', '🎵', '🌿', '🎭', '🏃', '🎨', '🍷', '🧘', '🥾', '🎤',
  '☕', '🍺', '🍸', '💃', '🎬', '📸', '🚴', '🏊', '🏋️', '📚', '🎲', '🌅',
  '🏖️', '👨‍🍳', '🤝', '🎸', '🚢', '🌮', '🧗', '🌙', '🧁', '🥂', '🎓', '🛶',
]
const inputCls = 'w-full px-4 py-2.5 rounded-xl border border-zinc-700 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500 bg-zinc-800 placeholder-zinc-500'

const emptyForm = {
  title: '', date: '', time: '', location: '', neighborhood: '',
  address: '', lat: '', lng: '', clubId: '', description: '',
  totalSpots: '20', price: '0', memberPrice: '',
  emoji: '🎉', status: 'published',
  isPremium: false, membersOnly: false, limitedSpots: true, isRecurring: false,
  approvalRequired: false,
  coverImage: '', coverImagePosition: 50, meetingUrl: '', whatsappUrl: '',
  minAge: '', maxAge: '',
  language: '', refundPolicy: '', registrationDeadline: '',
  endTime: '',
}

export default function HostEditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router  = useRouter()

  const [form,          setForm]          = useState(emptyForm)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [clubs,         setClubs]         = useState<{ id: string; name: string; emoji: string }[]>([])
  const [loading,       setLoading]       = useState(true)
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState('')
  const [repeat,        setRepeat]        = useState<'weekly' | 'biweekly' | 'monthly'>('weekly')
  const [occurrences,   setOccurrences]   = useState(4)
  const [spawning,      setSpawning]      = useState(false)
  const [hostId,        setHostId]        = useState('')
  const [aiNotes,       setAiNotes]       = useState('')
  const [aiLoading,     setAiLoading]     = useState(false)
  const [geocoding,     setGeocoding]     = useState(false)
  const [mapsUrl,       setMapsUrl]       = useState('')
  const [cohosts,       setCohosts]       = useState<{ id: string; userId: string; user: { id: string; name: string; color: string; profilePhoto: string | null } }[]>([])
  const [cohostSearch,  setCohostSearch]  = useState('')
  const [cohostResults, setCohostResults] = useState<{ id: string; name: string }[]>([])
  const [addingCohost,  setAddingCohost]  = useState(false)
  const [seriesId,      setSeriesId]      = useState<string | null>(null)

  async function geocodeAddress() {
    const query = [form.location, form.address, form.neighborhood, 'Istanbul, Turkey'].filter(Boolean).join(', ')
    setGeocoding(true)
    try {
      const res  = await fetch(`/app/api/admin/geocode?q=${encodeURIComponent(query)}`, { credentials: 'include' })
      const data = await res.json()
      if (Array.isArray(data) && data[0]) {
        setForm(f => ({ ...f, lat: parseFloat(data[0].lat).toFixed(6), lng: parseFloat(data[0].lon).toFixed(6) }))
        toast.success('Location found')
      } else {
        toast.error('No location found — paste a Google Maps link below instead')
      }
    } catch { toast.error('Geocoding failed — paste a Google Maps link below instead') }
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
        toast.success('Coordinates extracted from Maps link')
        return
      }
    }
    const placeMatch = url.match(/\/maps\/place\/([^/@?]+)/)
    if (placeMatch) {
      const placeName = decodeURIComponent(placeMatch[1].replace(/\+/g, ' '))
      setGeocoding(true)
      try {
        const res = await fetch(`/app/api/admin/geocode?q=${encodeURIComponent(placeName + ', Istanbul, Turkey')}`, { credentials: 'include' })
        const data = await res.json()
        if (Array.isArray(data) && data[0]) {
          setForm(f => ({ ...f, lat: parseFloat(data[0].lat).toFixed(6), lng: parseFloat(data[0].lon).toFixed(6) }))
          setMapsUrl('')
          toast.success('Location found from place name')
          return
        }
      } finally {
        setGeocoding(false)
      }
    }
    toast.error('Could not extract coordinates — try pasting a simpler Google Maps link or use the address lookup')
  }

  useEffect(() => {
    Promise.all([
      fetch(`/app/api/events/${id}`, { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/host/clubs', { credentials: 'include' }).then(r => r.ok ? r.json() : []),
      fetch('/app/api/auth/me', { credentials: 'include' }).then(r => r.json()),
      fetch(`/app/api/admin/events/${id}/cohosts`, { credentials: 'include' }).then(r => r.ok ? r.json() : []),
    ]).then(([event, hostClubs, me, cohostData]) => {
      if (Array.isArray(cohostData)) setCohosts(cohostData)
      if (me?.id) setHostId(me.id)
      setClubs(Array.isArray(hostClubs) ? hostClubs : [])
      if (event?.id) {
        setHostId(event.hostId ?? '')
        setForm({
          title:        event.title        ?? '',
          date:         event.date         ?? '',
          time:         event.time         ?? '',
          location:     event.location     ?? '',
          neighborhood: event.neighborhood ?? '',
          address:      event.address      ?? '',
          lat:          event.lat != null  ? String(event.lat)  : '',
          lng:          event.lng != null  ? String(event.lng)  : '',
          clubId:       event.clubId       ?? '',
          description:  event.description  ?? '',
          totalSpots:   String(event.totalSpots ?? 20),
          price:        String(event.price       ?? 0),
          memberPrice:  String(event.memberPrice ?? ''),
          emoji:        event.emoji        ?? '🎉',
          status:       event.status       ?? 'published',
          isPremium:    event.isPremium    ?? false,
          membersOnly:  event.membersOnly  ?? false,
          limitedSpots: event.limitedSpots ?? true,
          isRecurring:  event.isRecurring  ?? false,
          coverImage:         event.coverImage         ?? '',
          coverImagePosition: event.coverImagePosition ?? 50,
          meetingUrl:         event.meetingUrl         ?? '',
          whatsappUrl:        event.whatsappUrl        ?? '',
          minAge:       event.minAge != null   ? String(event.minAge)   : '',
          maxAge:       event.maxAge != null   ? String(event.maxAge)   : '',
          language:     event.language     ?? '',
          refundPolicy: event.refundPolicy ?? '',
          registrationDeadline: event.registrationDeadline ?? '',
          endTime:          event.endTime          ?? '',
          approvalRequired: event.approvalRequired ?? false,
        })
        if (Array.isArray(event.tags) && event.tags.length) setSelectedTagIds(event.tags)
        if (event.seriesId) setSeriesId(event.seriesId)
      }
      setLoading(false)
    })
  }, [id])

  function set(key: string, value: string | boolean | number) { setForm(f => ({ ...f, [key]: value })) }

  async function writeWithAI() {
    setAiLoading(true)
    const club = clubs.find(c => c.id === form.clubId)
    try {
      const res = await fetch('/app/api/host/events/describe', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:    form.title,
          location: form.location,
          vibes:    [],
          clubName: club ? `${club.emoji} ${club.name}` : undefined,
          notes:    aiNotes,
        }),
      })
      if (res.ok) {
        const { description } = await res.json()
        const html = description.split(/\n\n+/).map((p: string) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
        set('description', html)
      } else { toast.error('AI generation failed') }
    } catch { toast.error('AI generation failed') }
    setAiLoading(false)
  }

  async function searchCohostMembers(q: string) {
    if (q.length < 2) { setCohostResults([]); return }
    const res = await fetch(`/app/api/search?q=${encodeURIComponent(q)}&type=members`, { credentials: 'include' })
    if (!res.ok) return
    const data = await res.json()
    const members: { id: string; name: string }[] = Array.isArray(data.members) ? data.members : []
    setCohostResults(
      members
        .filter(m => !cohosts.some(c => c.userId === m.id) && m.id !== hostId)
        .slice(0, 6)
    )
  }

  async function addCohost(userId: string, name: string) {
    setAddingCohost(true)
    try {
      const res = await fetch(`/app/api/admin/events/${id}/cohosts`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      if (res.ok) {
        const data = await res.json()
        setCohosts(prev => [...prev.filter(c => c.userId !== userId), data])
        setCohostSearch(''); setCohostResults([])
      }
    } finally { setAddingCohost(false) }
  }

  async function removeCohost(userId: string, name: string) {
    if (!confirm(`Remove ${name} as co-host?`)) return
    await fetch(`/app/api/admin/events/${id}/cohosts`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    setCohosts(prev => prev.filter(c => c.userId !== userId))
  }

  function isValidUrl(v: string) { try { new URL(v); return true } catch { return false } }

  async function handleSave() {
    if (!form.neighborhood) { setError('Neighborhood is required'); return }
    if (form.meetingUrl && !isValidUrl(form.meetingUrl)) { setError('Map link must be a valid URL (https://…)'); return }
    if (form.whatsappUrl && !isValidUrl(form.whatsappUrl)) { setError('WhatsApp URL must be a valid URL (https://…)'); return }
    setError(''); setSaving(true)
    try {
      const res = await fetch(`/app/api/admin/events/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form, tagIds: selectedTagIds, vibes: [],
          minAge: form.minAge ? parseInt(form.minAge) : null,
          maxAge: form.maxAge ? parseInt(form.maxAge) : null,
          coverImage: form.coverImage || null, coverImagePosition: form.coverImagePosition,
          meetingUrl: form.meetingUrl || null,
          whatsappUrl: form.whatsappUrl || null, address: form.address || null,
          language: form.language || null, refundPolicy: form.refundPolicy || null,
          registrationDeadline: form.registrationDeadline || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to save'); return }
      router.push('/host/events')
    } catch { setError('Something went wrong') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!confirm('Delete this event?')) return
    const res = await fetch(`/app/api/admin/events/${id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) router.push('/host/events')
  }

  function buildSpawnDates(): string[] {
    if (!form.date) return []
    const days = repeat === 'weekly' ? 7 : repeat === 'biweekly' ? 14 : 0
    const dates: string[] = []
    const base = new Date(form.date)
    for (let i = 1; i <= occurrences; i++) {
      const d = new Date(base)
      if (repeat === 'monthly') d.setMonth(d.getMonth() + i)
      else d.setDate(d.getDate() + days * i)
      dates.push(d.toISOString().split('T')[0])
    }
    return dates
  }

  async function handleSpawn() {
    const dates = buildSpawnDates(); if (!dates.length) return
    setSpawning(true)

    const sid = seriesId ?? crypto.randomUUID()
    if (!seriesId) {
      await fetch(`/app/api/admin/events/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesId: sid }),
      })
      setSeriesId(sid)
    }

    const payload = {
      ...form, hostId, tagIds: selectedTagIds, vibes: [], seriesId: sid, isRecurring: true,
      minAge: form.minAge ? parseInt(form.minAge) : null,
      maxAge: form.maxAge ? parseInt(form.maxAge) : null,
      coverImage: form.coverImage || null, meetingUrl: form.meetingUrl || null,
      whatsappUrl: form.whatsappUrl || null, address: form.address || null,
      language: form.language || null, refundPolicy: form.refundPolicy || null,
      registrationDeadline: null,
    }
    try {
      for (const date of dates) {
        const res = await fetch('/app/api/admin/events', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, date }),
        })
        if (!res.ok) { toast.error('Failed to create some events'); setSpawning(false); return }
      }
      toast.success(`Created ${dates.length} events — all linked as a series`)
    } catch { toast.error('Something went wrong') }
    finally { setSpawning(false) }
  }

  if (loading) return <div className="p-8 text-center text-zinc-500 text-sm">Loading…</div>

  return (
    <div className="p-4 sm:p-8 max-w-3xl">

      <div className="flex items-center gap-3 mb-4 sm:mb-8">
        <Link href="/host/events" className="text-zinc-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Edit event</h1>
          <p className="text-sm text-zinc-400 mt-0.5">{form.title}</p>
        </div>
      </div>

      {error && <div className="mb-6 px-4 py-3 bg-red-900/30 border border-red-700 rounded-xl text-red-300 text-sm font-medium">{error}</div>}

      <div className="space-y-6">
        <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-6">
          <h2 className="font-bold text-white mb-5">Basic info</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="col-span-full">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Event title</label>
              <input type="text" value={form.title} onChange={e => set('title', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Club</label>
              <select value={form.clubId} onChange={e => set('clubId', e.target.value)} className={inputCls}>
                {clubs.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Status</label>
              {form.status === 'pending' ? (
                <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm font-semibold">
                  ⏳ Pending admin approval
                </div>
              ) : (
                <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
                  <option value="draft">Draft</option>
                  <option value="pending">Submit for review</option>
                  <option value="postponed">Postponed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              )}
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Language</label>
              <input type="text" value={form.language} onChange={e => set('language', e.target.value)} placeholder="e.g. English" className={inputCls} />
            </div>
            {/* Co-hosts */}
            <div className="col-span-full">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Co-hosts</label>
              {cohosts.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {cohosts.map(c => (
                    <div key={c.id} className="flex items-center gap-1.5 bg-zinc-700 rounded-xl px-3 py-1.5">
                      <span className="text-xs text-white font-medium">{c.user.name}</span>
                      <button type="button" onClick={() => removeCohost(c.userId, c.user.name)}
                        className="text-zinc-400 hover:text-red-400 transition-colors text-sm leading-none ml-1">×</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="relative">
                <input type="text" placeholder="Search member to add as co-host…"
                  value={cohostSearch}
                  onChange={e => { setCohostSearch(e.target.value); searchCohostMembers(e.target.value) }}
                  className={inputCls} />
                {cohostSearch.length >= 2 && cohostResults.length === 0 && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-xs text-zinc-500 shadow-lg">
                    No members found
                  </div>
                )}
                {cohostResults.length > 0 && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden shadow-lg">
                    {cohostResults.map(m => (
                      <button key={m.id} type="button" onClick={() => addCohost(m.id, m.name)} disabled={addingCohost}
                        className="w-full text-left px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors">
                        {m.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="col-span-full">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Description</label>
              <div className="mb-2 bg-zinc-800/60 border border-zinc-700 rounded-xl p-3 space-y-2">
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Write with AI</p>
                <input
                  type="text"
                  value={aiNotes}
                  onChange={e => setAiNotes(e.target.value)}
                  placeholder="Extra context for AI (optional)…"
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
              <RichTextEditor value={form.description} onChange={v => set('description', v)} placeholder="Write a compelling description…" />
            </div>
            <div className="col-span-full">
              <ImageUpload value={form.coverImage} onChange={url => set('coverImage', url)} folder="events"
                position={form.coverImagePosition} onPositionChange={pos => set('coverImagePosition', pos)} />
            </div>
          </div>
        </section>

        <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-6">
          <h2 className="font-bold text-white mb-5">When & where</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="col-span-1 sm:col-span-full">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Date</label>
              <input type="text" value={form.date} onChange={e => set('date', e.target.value)} placeholder="YYYY-MM-DD" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Start time</label>
              <input type="text" value={form.time} onChange={e => set('time', e.target.value)} placeholder="e.g. 19:30" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">End time</label>
              <input type="text" value={form.endTime} onChange={e => set('endTime', e.target.value)} placeholder="e.g. 22:00" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Registration deadline</label>
              <input type="text" value={form.registrationDeadline} onChange={e => set('registrationDeadline', e.target.value)} placeholder="YYYY-MM-DD" className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Venue name</label>
              <input type="text" value={form.location} onChange={e => set('location', e.target.value)} className={inputCls} />
            </div>
            <div className="col-span-full">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Neighborhood</label>
              <select value={form.neighborhood} onChange={e => set('neighborhood', e.target.value)} className={inputCls}>
                <option value="">Select neighborhood…</option>
                {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="col-span-full">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Full address</label>
              <div className="flex gap-2">
                <input type="text" value={form.address} onChange={e => set('address', e.target.value)} onBlur={() => { if (form.address.trim() && !form.lat) geocodeAddress() }} className={`${inputCls} flex-1`} />
                <button type="button" onClick={geocodeAddress} disabled={geocoding || (!form.location && !form.address)}
                  className="shrink-0 px-3 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold disabled:opacity-40 transition-colors whitespace-nowrap">
                  {geocoding ? '…' : '📍 Look up'}
                </button>
              </div>
              {form.lat && form.lng && (
                <p className="text-xs text-green-400 mt-1.5">✓ Location set ({parseFloat(form.lat).toFixed(4)}, {parseFloat(form.lng).toFixed(4)})</p>
              )}
            </div>

            <div className="col-span-full">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">
                Or paste a Google Maps link
                <span className="font-normal text-zinc-500 ml-1">(open in Maps → Share → Copy link)</span>
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
            <div className="col-span-full">
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Map link <span className="font-normal text-zinc-500">(Google Maps, etc.)</span></label>
              <input type="text" value={form.meetingUrl} onChange={e => set('meetingUrl', e.target.value)} placeholder="https://maps.google.com/..." className={inputCls} />
            </div>
          </div>
        </section>

        <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-6">
          <h2 className="font-bold text-white mb-5">Capacity & pricing</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Total spots</label>
              <input type="number" min="1" value={form.totalSpots} onChange={e => set('totalSpots', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Guest price</label>
              <input type="number" min="0" value={form.price} onChange={e => set('price', e.target.value)} className={inputCls} />
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
          <div className="mb-4">
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Refund policy</label>
            <input type="text" value={form.refundPolicy} onChange={e => set('refundPolicy', e.target.value)} className={inputCls} />
          </div>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">WhatsApp group URL</label>
            <input type="text" value={form.whatsappUrl} onChange={e => set('whatsappUrl', e.target.value)} className={inputCls} />
          </div>
          <div className="flex flex-wrap gap-4">
            {[
              { key: 'limitedSpots',     label: 'Limited spots'        },
              { key: 'isPremium',        label: '♛ Premium'            },
              { key: 'membersOnly',      label: '🔒 Members only'      },
              { key: 'isRecurring',      label: '🔁 Recurring'         },
              { key: 'approvalRequired', label: '✋ Approval required' },
              { key: 'genderBalance',    label: '⚖️ Gender balance'    },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form[key as keyof typeof form] as boolean}
                  onChange={e => set(key, e.target.checked)} className="w-4 h-4 rounded accent-amber-500" />
                <span className="text-sm text-zinc-300">{label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-bold text-white">Vibe</h2>
            <button
              type="button"
              onClick={async () => {
                setAiLoading(true)
                try {
                  const res = await fetch('/app/api/host/events/suggest-tags', {
                    method: 'POST', credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: form.title, description: form.description }),
                  })
                  if (res.ok) {
                    const { tagIds } = await res.json()
                    if (tagIds?.length) setSelectedTagIds((prev: string[]) => [...new Set([...prev, ...tagIds])])
                  } else { toast.error('AI suggestion failed') }
                } catch { toast.error('AI suggestion failed') }
                setAiLoading(false)
              }}
              disabled={aiLoading || (!form.title && !form.description)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 transition-colors disabled:opacity-40"
            >
              {aiLoading ? '⏳ Suggesting…' : '✦ Suggest tags'}
            </button>
          </div>
          <VibePicker selectedIds={selectedTagIds} onChange={setSelectedTagIds} />
        </section>

        <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-6">
          <h2 className="font-bold text-white mb-5">Event emoji</h2>
          <div className="flex flex-wrap gap-3">
            {EMOJIS.map(e => (
              <button key={e} onClick={() => set('emoji', e)}
                className={`w-12 h-12 rounded-xl text-2xl flex items-center justify-center transition-all ${form.emoji === e ? 'bg-amber-500/20 ring-2 ring-amber-500 scale-110' : 'bg-zinc-800 hover:bg-zinc-700'}`}>
                {e}
              </button>
            ))}
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
          <button onClick={handleDelete} className="text-sm px-4 py-2.5 rounded-xl text-red-400 hover:bg-red-900/20 border border-red-900 transition-colors">
            Delete event
          </button>
          <div className="flex gap-3">
            <Link href="/host/events" className="px-5 py-2.5 text-sm font-medium text-zinc-300 border border-zinc-700 rounded-xl hover:bg-zinc-800 transition-colors">
              Cancel
            </Link>
            <button onClick={handleSave} disabled={saving} className="px-6 py-2.5 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-xl transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>

        <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-6">
          <h2 className="text-base font-bold text-white mb-1">Create recurring copies</h2>
          <p className="text-xs text-zinc-500 mb-4">Duplicate this event into future dates.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Repeat</label>
              <select value={repeat} onChange={e => setRepeat(e.target.value as typeof repeat)} className={inputCls}>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Occurrences</label>
              <input type="number" min={1} max={52} value={occurrences} onChange={e => setOccurrences(parseInt(e.target.value) || 1)} className={inputCls} />
            </div>
            <div className="flex items-end">
              <button onClick={handleSpawn} disabled={spawning || !form.date} className="w-full px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50">
                {spawning ? 'Creating…' : `Create ${occurrences} more`}
              </button>
            </div>
          </div>
          {form.date && buildSpawnDates().length > 0 && (
            <p className="text-xs text-zinc-500 mt-3">
              Will create on: {buildSpawnDates().map(d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })).join(' · ')}
            </p>
          )}
        </section>
      </div>
    </div>
  )
}
