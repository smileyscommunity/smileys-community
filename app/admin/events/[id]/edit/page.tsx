'use client'

import { toast } from 'sonner'
import { useState, useEffect, use } from 'react'
import { confirmToast } from '@/lib/confirmToast'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ISTANBUL_NEIGHBORHOODS } from '@/lib/data'
import ImageUpload from '@/components/ImageUpload'
import VibePicker from '@/components/VibePicker'
import RichTextEditor from '@/components/RichTextEditor'
import { useAdminMemberSearch } from '@/hooks/useAdminMemberSearch'
const EMOJIS = [
  '⛵', '🍽️', '💬', '🎵', '🌿', '🎭', '🏃', '🎨', '🍷', '🧘', '🥾', '🎤',
  '☕', '🍺', '🍸', '💃', '🎬', '📸', '🚴', '🏊', '🏋️', '📚', '🎲', '🌅',
  '🏖️', '👨‍🍳', '🤝', '🎸', '🚢', '🌮', '🧗', '🌙', '🧁', '🥂', '🎓', '🛶',
  '🗺️', '🏛️', '🕌', '🌍', '🗼', '🌊', '🏙️', '🌺', '🕍', '⛪',
  '🎯', '🃏', '♟️', '🎳', '🪄', '🧩', '🎪', '🪂',
  '🧖', '🌸', '🫶', '🧠', '🫁',
  '🛍️', '🪸', '🌴', '🦋', '🐚', '🌻', '🍃', '🎋', '🌄', '🏕️',
  '🍣', '🥘', '🧆', '🥗', '🍜', '🧋', '🍹', '🫖',
  '🏇', '🤿', '🧜', '🪁', '🏄', '🎠', '🎡',
  '⚽', '🏀', '🎾', '🏐', '🥊', '🏆', '⛷️',
  '🪩', '🕺', '🎊', '🌃', '🎆',
  '🧿', '🏺',
  '🎹', '🎷', '🎺', '🥁', '🎻',
  '🏔️', '🌈', '🌠',
  '🐱', '🐾', '🐟',
  '🍕', '🍰', '🥐', '🍫',
  '🎞️', '🎥', '📽️', '🍿', '🧺', '🌳', '💻', '🖥️',
]
const inputCls = 'bg-zinc-800 border border-zinc-700 text-white placeholder-zinc-500 rounded-xl focus:ring-2 focus:ring-amber-500 focus:outline-none px-3 py-2.5 w-full text-sm'

const emptyForm = {
  title: '', date: '', time: '', location: '', neighborhood: '',
  address: '', clubId: '', hostId: '', description: '',
  totalSpots: '20', price: '0', memberPrice: '', payTo: 'venue', paymentContact: '', ticketUrl: '',
  emoji: '🎉', status: 'published',
  isPremium: false, membersOnly: false, limitedSpots: true, isFirstTimerFriendly: false, isRecurring: false,
  approvalRequired: false,
  genderBalance: false, maleQuota: '', femaleQuota: '', turkishMaleQuota: '',
  coverImage: '', coverImagePosition: 50, meetingUrl: '', whatsappUrl: '',
  minAge: '', maxAge: '',
  language: '', refundPolicy: '', registrationDeadline: '',
  endTime: '', lat: '', lng: '',
}

export default function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router  = useRouter()

  const [form,          setForm]          = useState(emptyForm)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [clubs,         setClubs]         = useState<{ id: string; name: string; emoji: string }[]>([])
  const [hostSearch,    setHostSearch]    = useState('')
  const [loading,       setLoading]       = useState(true)
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState('')
  const [success,       setSuccess]       = useState('')
  const [repeat,        setRepeat]        = useState<'weekly' | 'biweekly' | 'monthly'>('weekly')
  const [occurrences,   setOccurrences]   = useState(4)
  const [spawning,      setSpawning]      = useState(false)
  const [spawnMsg,      setSpawnMsg]      = useState('')
  const [geocoding,     setGeocoding]     = useState(false)
  const [mapsUrl,       setMapsUrl]       = useState('')
  const [aiNotes,       setAiNotes]       = useState('')
  const [aiLoading,     setAiLoading]     = useState(false)
  const [cohosts,       setCohosts]       = useState<{ id: string; userId: string; user: { id: string; name: string; color: string; profilePhoto: string | null } }[]>([])
  const [cohostSearch,  setCohostSearch]  = useState('')
  const [addingCohost,  setAddingCohost]  = useState(false)
  const [seriesId,      setSeriesId]      = useState<string | null>(null)
  const [seriesModal,   setSeriesModal]   = useState(false)
  const [pendingSavePayload, setPendingSavePayload] = useState<object | null>(null)

  // Server-side search — the /api/admin/users list caps at the newest
  // 1000 users, so filtering a one-shot fetch client-side made early
  // members unfindable as host/co-host once the community grew past that.
  const { results: hostMatches }   = useAdminMemberSearch(form.hostId ? '' : hostSearch, 1)
  const { results: cohostMatches } = useAdminMemberSearch(cohostSearch, 1)

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
    toast.error('Could not extract coordinates — try pasting a Google Maps link with a visible location pin')
  }

  useEffect(() => {
    Promise.all([
      fetch(`/app/api/events/${id}`, { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/clubs', { credentials: 'include' }).then(r => r.json()),
      fetch(`/app/api/admin/events/${id}/cohosts`, { credentials: 'include' }).then(r => r.json()),
    ]).then(([event, clubData, cohostData]) => {
      if (Array.isArray(cohostData)) setCohosts(cohostData)
      if (event?.id) {
        setHostSearch(event.hostName ?? '')
        setForm({
          title:        event.title        ?? '',
          date:         event.date         ?? '',
          time:         event.time         ?? '',
          location:     event.location     ?? '',
          neighborhood: event.neighborhood ?? '',
          address:      event.address      ?? '',
          clubId:       event.clubId       ?? '',
          hostId:       event.hostId       ?? '',
          description:  event.description  ?? '',
          totalSpots:   String(event.totalSpots  ?? 20),
          price:        String(event.price        ?? 0),
          memberPrice:  String(event.memberPrice  ?? ''),
          payTo:        event.payTo ?? 'venue',
          paymentContact: event.paymentContact ?? '',
          ticketUrl:    event.ticketUrl ?? '',
          genderBalance:    event.genderBalance ?? false,
          maleQuota:        event.maleQuota        != null ? String(event.maleQuota)        : '',
          femaleQuota:      event.femaleQuota      != null ? String(event.femaleQuota)      : '',
          turkishMaleQuota: event.turkishMaleQuota != null ? String(event.turkishMaleQuota) : '',
          emoji:        event.emoji        ?? '🎉',
          status:       event.status       ?? 'published',
          isPremium:    event.isPremium    ?? false,
          membersOnly:  event.membersOnly  ?? false,
          limitedSpots: event.limitedSpots ?? true,
          isFirstTimerFriendly: event.isFirstTimerFriendly ?? false,
          isRecurring:  event.isRecurring  ?? false,
          coverImage:         event.coverImage         ?? '',
          coverImagePosition: event.coverImagePosition ?? 50,
          meetingUrl:         event.meetingUrl         ?? '',
          whatsappUrl:  event.whatsappUrl  ?? '',
          minAge:       event.minAge != null   ? String(event.minAge)   : '',
          maxAge:       event.maxAge != null   ? String(event.maxAge)   : '',
          language:     event.language     ?? '',
          refundPolicy: event.refundPolicy ?? '',
          registrationDeadline: event.registrationDeadline ?? '',
          endTime:          event.endTime          ?? '',
          approvalRequired: event.approvalRequired ?? false,
          lat:              event.lat  != null ? String(event.lat)  : '',
          lng:              event.lng  != null ? String(event.lng)  : '',
        })
        if (Array.isArray(event.tags) && event.tags.length) setSelectedTagIds(event.tags)
        if (event.seriesId) setSeriesId(event.seriesId)
      }
      setClubs(Array.isArray(clubData) ? clubData : [])
      setLoading(false)
    })
  }, [id])

  function set(key: string, value: string | boolean | number) { setForm(f => ({ ...f, [key]: value })) }

  async function writeWithAI() {
    setAiLoading(true)
    const club = clubs.find(c => c.id === form.clubId)
    const res = await fetch('/app/api/host/events/describe', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: form.title, location: form.location, vibes: [], clubName: club ? `${club.emoji} ${club.name}` : undefined, notes: aiNotes }),
    })
    if (res.ok) { const { description } = await res.json(); set('description', description.split(/\n\n+/).map((p: string) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')) }
    setAiLoading(false)
  }

  async function suggestTags() {
    setAiLoading(true)
    const res = await fetch('/app/api/host/events/suggest-tags', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: form.title, description: form.description }),
    })
    if (res.ok) { const { tagIds } = await res.json(); if (tagIds?.length) setSelectedTagIds((prev: string[]) => [...new Set([...prev, ...tagIds])]) }
    setAiLoading(false)
  }

  async function geocodeAddress() {
    const query = [form.location, form.address, form.neighborhood, 'Istanbul, Turkey'].filter(Boolean).join(', ')
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

  async function addCohost(userId: string) {
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
        setCohostSearch('')
      }
    } finally { setAddingCohost(false) }
  }

  async function removeCohost(userId: string) {
    await fetch(`/app/api/admin/events/${id}/cohosts`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    setCohosts(prev => prev.filter(c => c.userId !== userId))
  }

  function buildSavePayload(applyToSeries = false) {
    return {
      ...form, tagIds: selectedTagIds, vibes: [], applyToSeries,
      minAge:    form.minAge    ? parseInt(form.minAge)   : null,
      maxAge:    form.maxAge    ? parseInt(form.maxAge)   : null,
      // Gender balance — turning the toggle off clears the quotas so a
      // stale cap can't silently keep gating RSVPs.
      maleQuota:        form.genderBalance && form.maleQuota        ? parseInt(form.maleQuota)        : null,
      femaleQuota:      form.genderBalance && form.femaleQuota      ? parseInt(form.femaleQuota)      : null,
      turkishMaleQuota: form.genderBalance && form.turkishMaleQuota ? parseInt(form.turkishMaleQuota) : null,
      coverImage:         form.coverImage   || null,
      coverImagePosition: form.coverImagePosition,
      meetingUrl:         form.meetingUrl   || null,
      whatsappUrl:  form.whatsappUrl  || null,
      address:      form.address      || null,
      language:     form.language     || null,
      refundPolicy: form.refundPolicy || null,
      registrationDeadline: form.registrationDeadline || null,
      clubId:       form.clubId       || null,
      hostId:       form.hostId       || null,
      lat:  form.lat  ? parseFloat(form.lat)  : null,
      lng:  form.lng  ? parseFloat(form.lng)  : null,
    }
  }

  async function doSave(payload: object) {
    setSaving(true)
    try {
      const res = await fetch(`/app/api/admin/events/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to save'); return }
      if (form.hostId && form.clubId) {
        await fetch(`/app/api/admin/clubs/${form.clubId}/hosts`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: form.hostId, role: 'host' }),
        })
      }
      router.push('/admin/events')
    } catch { setError('Something went wrong') }
    finally { setSaving(false) }
  }

  async function handleSave() {
    if (!form.neighborhood) { setError('Neighborhood is required'); return }
    setError('')
    const payload = buildSavePayload()
    // If part of a series, ask whether to apply to all future events
    if (seriesId) {
      setPendingSavePayload(payload)
      setSeriesModal(true)
      return
    }
    await doSave(payload)
  }

  async function handleSaveThisOnly() {
    setSeriesModal(false)
    await doSave(pendingSavePayload!)
  }

  async function handleSaveDateOnly() {
    if (!form.date) return
    setSaving(true)
    try {
      const res = await fetch(`/app/api/admin/events/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: form.date, applyToSeries: false }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to save date'); return }
      setError('')
      setSuccess(`Date updated to ${form.date}`)
    } catch { setError('Something went wrong') }
    finally { setSaving(false) }
  }

  async function handleSaveAllFuture() {
    setSeriesModal(false)
    await doSave({ ...pendingSavePayload, applyToSeries: true })
  }

  async function handleDelete() {
    if (!(await confirmToast('Delete this event?'))) return
    const res = await fetch(`/app/api/admin/events/${id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) router.push('/admin/events')
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
    setSpawning(true); setSpawnMsg('')

    // Use existing seriesId or generate a new one to link all events in this series
    const sid = seriesId ?? crypto.randomUUID()

    // If this event doesn't have a seriesId yet, assign it now
    if (!seriesId) {
      await fetch(`/app/api/admin/events/${id}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seriesId: sid }),
      })
      setSeriesId(sid)
    }

    const payload = {
      ...form, tagIds: selectedTagIds, vibes: [], seriesId: sid, isRecurring: true,
      minAge: form.minAge ? parseInt(form.minAge) : null,
      maxAge: form.maxAge ? parseInt(form.maxAge) : null,
      coverImage: form.coverImage || null, coverImagePosition: form.coverImagePosition,
      meetingUrl: form.meetingUrl || null,
      whatsappUrl: form.whatsappUrl || null, address: form.address || null,
      language: form.language || null, refundPolicy: form.refundPolicy || null,
      registrationDeadline: null,
      lat: form.lat ? parseFloat(form.lat) : null,
      lng: form.lng ? parseFloat(form.lng) : null,
    }
    try {
      for (const date of dates) {
        const res = await fetch('/app/api/admin/events', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, date }),
        })
        if (!res.ok) { setSpawnMsg('Failed to create some events'); setSpawning(false); return }
      }
      setSpawnMsg(`✓ Created ${dates.length} events — all linked as a series`)
    } catch { setSpawnMsg('Something went wrong') }
    finally { setSpawning(false) }
  }

  if (loading) return <div className="p-8 text-center text-zinc-500 text-sm">Loading…</div>

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl">

      {/* Series update modal */}
      {seriesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <div>
                <p className="text-white font-bold text-sm">This event is part of a series</p>
                <p className="text-zinc-400 text-xs mt-0.5">Apply changes to just this date, or all future events?</p>
              </div>
            </div>
            <div className="space-y-2">
              <button onClick={handleSaveThisOnly} disabled={saving}
                className="w-full py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 text-left">
                This event only
                <p className="text-xs text-zinc-500 font-normal mt-0.5">Only update {form.date}</p>
              </button>
              <button onClick={handleSaveAllFuture} disabled={saving}
                className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold transition-colors disabled:opacity-50 text-left">
                All future events in this series
                <p className="text-xs text-amber-200 font-normal mt-0.5">Updates all upcoming events with the same title, price, location, etc.</p>
              </button>
              <button onClick={() => setSeriesModal(false)} className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 transition-colors py-1">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Link href="/admin/events" className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-white text-2xl font-extrabold tracking-tight">Edit event</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            {form.title}
            {seriesId && <span className="ml-2 text-xs font-bold px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400">🔁 Series</span>}
          </p>
        </div>
      </div>

      {error && <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-medium">{error}</div>}

      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-5">
        <h2 className="text-white font-bold mb-5">Basic info</h2>
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
          <div className="relative">
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Host</label>
            <input type="text" placeholder="Search member…" value={hostSearch}
              onChange={e => { setHostSearch(e.target.value); set('hostId', '') }} className={inputCls} />
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
            {form.hostId && <p className="text-xs text-green-400 mt-1">✓ {hostSearch}</p>}
          </div>

          {/* Co-hosts */}
          <div className="col-span-full">
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Co-hosts</label>
            {cohosts.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {cohosts.map(c => (
                  <div key={c.id} className="flex items-center gap-1.5 bg-zinc-700 rounded-xl px-3 py-1.5">
                    <span className="text-xs text-white font-medium">{c.user.name}</span>
                    <button onClick={() => removeCohost(c.userId)}
                      className="text-zinc-400 hover:text-red-400 transition-colors text-sm leading-none ml-1">×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="relative">
              <input type="text" placeholder="Search member to add as co-host…"
                value={cohostSearch}
                onChange={e => setCohostSearch(e.target.value)}
                className={inputCls} />
              {cohostSearch && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden shadow-lg">
                  {cohostMatches
                    .filter(m =>
                      !cohosts.some(c => c.userId === m.id) &&
                      m.id !== form.hostId
                    )
                    .slice(0, 6)
                    .map(m => (
                      <button key={m.id} onClick={() => addCohost(m.id)} disabled={addingCohost}
                        className="w-full text-left px-4 py-2.5 text-sm text-zinc-200 hover:bg-zinc-700 transition-colors">
                        {m.name}
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
              <option value="pending">Pending (awaiting approval)</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="postponed">Postponed</option>
              <option value="cancelled">Cancelled</option>
              <option value="archived">Archived</option>
            </select>
            {form.status === 'pending' && (
              <button
                type="button"
                onClick={() => set('status', 'published')}
                className="mt-2 w-full px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-xl transition-colors"
              >
                ✓ Approve & Publish
              </button>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Language</label>
            <input type="text" value={form.language} onChange={e => set('language', e.target.value)} placeholder="e.g. English" className={inputCls} />
          </div>
          <div className="col-span-full">
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
            <RichTextEditor value={form.description} onChange={v => set('description', v)} placeholder="Write a compelling description…" />
          </div>
          <div className="col-span-full">
            <ImageUpload value={form.coverImage} onChange={url => set('coverImage', url)} folder="events"
              position={form.coverImagePosition} onPositionChange={pos => set('coverImagePosition', pos)} />
          </div>
        </div>
      </section>

      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-5">
        <h2 className="text-white font-bold mb-5">When & Where</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="col-span-full">
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Date</label>
            <div className="flex gap-2">
              <input type="date" value={form.date} onChange={e => { set('date', e.target.value); setSuccess('') }} className={`${inputCls} admin-date-input flex-1`} />
              {seriesId && (
                <button type="button" onClick={handleSaveDateOnly} disabled={saving || !form.date}
                  className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-xl transition-colors disabled:opacity-50 shrink-0">
                  Save date
                </button>
              )}
            </div>
            {success && <p className="text-xs text-green-400 mt-1">{success}</p>}
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Start time</label>
            <input type="time" value={form.time} onChange={e => set('time', e.target.value)} className={`${inputCls} admin-date-input`} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">End time</label>
            <input type="time" value={form.endTime} onChange={e => set('endTime', e.target.value)} className={`${inputCls} admin-date-input`} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Registration deadline</label>
            <input type="date" value={form.registrationDeadline} onChange={e => set('registrationDeadline', e.target.value)} className={`${inputCls} admin-date-input`} />
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
              <input type="text" value={form.address} onChange={e => set('address', e.target.value)} placeholder="e.g. Kemankeş Cad. No:10, Karaköy" className={`${inputCls} flex-1`} />
              <button type="button" onClick={geocodeAddress} disabled={geocoding || (!form.location && !form.address)}
                className="shrink-0 px-3 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold disabled:opacity-40 transition-colors">
                {geocoding ? '…' : '📍 Look up'}
              </button>
            </div>
            {form.lat && form.lng && (
              <p className="text-xs text-green-400 mt-1.5">✓ Location set ({parseFloat(form.lat).toFixed(4)}, {parseFloat(form.lng).toFixed(4)})</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Latitude</label>
            <input type="number" step="0.000001" value={form.lat} onChange={e => set('lat', e.target.value)} placeholder="e.g. 41.0369" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Longitude</label>
            <input type="number" step="0.000001" value={form.lng} onChange={e => set('lng', e.target.value)} placeholder="e.g. 28.9772" className={inputCls} />
          </div>

          <div className="col-span-full">
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
        </div>
      </section>

      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-5">
        <h2 className="text-white font-bold mb-5">Capacity & pricing</h2>
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
            <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Who collects payment?</label>
            <select value={form.payTo} onChange={e => set('payTo', e.target.value)} className={inputCls}>
              <option value="venue">At the event — venue or organizer collects</option>
              <option value="smileys">Smileys — we collect and reconcile</option>
            </select>
          </div>
          {form.payTo === 'venue' && (
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Ticket link (external)</label>
              <input type="text" value={form.ticketUrl} onChange={e => set('ticketUrl', e.target.value)}
                placeholder="https://… (optional)" className={inputCls} />
              <p className="text-xs text-zinc-600 mt-1">Shown as a “Buy tickets” button on the event page.</p>
            </div>
          )}
          {form.payTo === 'smileys' && (
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1.5">Payment contact (WhatsApp)</label>
              <input type="text" value={form.paymentContact} onChange={e => set('paymentContact', e.target.value)}
                placeholder="+90 555 000 0000" className={inputCls} />
            </div>
          )}
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
          <input type="text" value={form.refundPolicy} onChange={e => set('refundPolicy', e.target.value)} placeholder="e.g. Full refund up to 48h before" className={inputCls} />
        </div>
        <div className="mb-4">
          <label className="block text-xs font-semibold text-zinc-400 mb-1.5">WhatsApp group URL</label>
          <input type="text" value={form.whatsappUrl} onChange={e => set('whatsappUrl', e.target.value)} placeholder="https://chat.whatsapp.com/..." className={inputCls} />
        </div>
        <div className="flex flex-wrap gap-4">
          {[
            { key: 'limitedSpots', label: 'Limited spots'   },
            { key: 'isPremium',    label: '♛ Premium'       },
            { key: 'membersOnly',  label: '🔒 Members only' },
            { key: 'isFirstTimerFriendly', label: '👋 First-timer friendly' },
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
        {/* Quotas — same block as the create form; previously quotas
            could only be set at creation and were invisible here. */}
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

      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-5">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-bold">Vibe</h2>
          <button type="button" onClick={suggestTags} disabled={aiLoading || (!form.title && !form.description)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border border-violet-500/20 transition-colors disabled:opacity-40">
            {aiLoading ? '⏳ Suggesting…' : '✦ Suggest tags'}
          </button>
        </div>
        <VibePicker selectedIds={selectedTagIds} onChange={setSelectedTagIds} />
      </section>

      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-5">
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

      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <button onClick={handleDelete} className="text-sm px-4 py-2.5 rounded-xl text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors">
          Delete event
        </button>
        <div className="flex gap-3">
          <Link href="/admin/events" className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-xl px-4 py-2 text-sm font-semibold">Cancel</Link>
          <button onClick={handleSave} disabled={saving} className="bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl px-6 py-2 text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      <section className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 sm:p-5">
        <h2 className="text-white font-bold mb-1">Create recurring copies</h2>
        <p className="text-xs text-zinc-500 mb-4">Duplicate this event into future dates. The current event is not changed.</p>
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
            <button onClick={handleSpawn} disabled={spawning || !form.date} className="w-full bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition-colors disabled:opacity-50">
              {spawning ? 'Creating…' : `Create ${occurrences} more`}
            </button>
          </div>
        </div>
        {form.date && buildSpawnDates().length > 0 && (
          <p className="text-xs text-zinc-500 mt-3">
            Will create on: {buildSpawnDates().map(d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })).join(' · ')}
          </p>
        )}
        {spawnMsg && <p className={`text-xs mt-2 font-medium ${spawnMsg.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>{spawnMsg}</p>}
      </section>
    </div>
  )
}
