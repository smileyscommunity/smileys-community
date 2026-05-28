'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { ISTANBUL_NEIGHBORHOODS, resolveImageUrl } from '@/lib/data'
import { toast } from 'sonner'

// Spontaneous hangouts — members only (real-time, contact-required). Auto-
// expires server-side via the cron when endsAt is past.

interface JoinerSummary {
  id: string; name: string; color: string; profilePhoto: string | null
  // Only the host slot includes goodHangouts (we don't fetch it for every
  // joiner in the avatar strip — too noisy and the trust signal is mostly
  // about who's hosting).
  goodHangouts?: number
}

interface Hangout {
  id:           string
  title:        string
  description:  string | null
  location:     string
  neighborhood: string | null
  startsAt:     string
  endsAt:       string
  status:       string
  meetMode:     'solo' | 'group'
  // Optional photo of the meeting spot — single image URL.
  photo:        string | null
  user:         JoinerSummary
  joiners:      JoinerSummary[]
  joinedByMe:   boolean
  messageCount: number
}

// Lightweight "I'm around" pulse — see AvailabilityPulse in schema.prisma.
// Renders as a different card type interleaved in the feed.
interface Pulse {
  id:           string
  neighborhood: string | null
  note:         string | null
  until:        string
  createdAt:    string
  user:         JoinerSummary
  isMine:       boolean
}

type ModeFilter = 'all' | 'solo' | 'group'

interface HangoutMessage {
  id:        string
  body:      string
  createdAt: string
  user:      JoinerSummary
}

function formatWindow(startsAt: string, endsAt: string) {
  const s = new Date(startsAt)
  const e = new Date(endsAt)
  const sameDay = s.toDateString() === e.toDateString()
  const now = new Date()
  const minsToStart = Math.round((s.getTime() - now.getTime()) / 60_000)

  const fmtTime = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  let prefix = ''
  if (minsToStart < 0)        prefix = 'Now · '
  else if (minsToStart < 60)  prefix = `In ${minsToStart}m · `
  else if (sameDay)           prefix = 'Today · '
  else                        prefix = s.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · '

  return `${prefix}${fmtTime(s)}–${fmtTime(e)}`
}

function defaultStartsAt(): string {
  // 15 min from now, rounded — covers "I'm walking there"
  const d = new Date(Date.now() + 15 * 60_000)
  d.setSeconds(0, 0)
  return d.toISOString().slice(0, 16) // YYYY-MM-DDTHH:MM
}
function defaultEndsAt(): string {
  // 2 hours after default start — typical café hangout window
  const d = new Date(Date.now() + 2 * 60 * 60_000 + 15 * 60_000)
  d.setSeconds(0, 0)
  return d.toISOString().slice(0, 16)
}

export default function HangoutsPage() {
  const router = useRouter()
  const { user, isLoggedIn, isLoading } = useAuth()

  const [hangouts, setHangouts] = useState<Hangout[]>([])
  const [pulses,   setPulses]   = useState<Pulse[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showPulseForm, setShowPulseForm] = useState(false)
  // Filter chip — defaults to 'all' so newcomers see the full feed.
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all')

  // Hangout form
  const [title,        setTitle]        = useState('')
  const [location,     setLocation]     = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [description,  setDescription]  = useState('')
  const [startsAt,     setStartsAt]     = useState(defaultStartsAt())
  const [endsAt,       setEndsAt]       = useState(defaultEndsAt())
  const [meetMode,     setMeetMode]     = useState<'group' | 'solo'>('group')
  const [photo,        setPhoto]        = useState<string | null>(null)
  const [uploading,    setUploading]    = useState(false)
  const [submitting,   setSubmitting]   = useState(false)

  // Pulse form
  const [pulseNote,         setPulseNote]         = useState('')
  const [pulseNeighborhood, setPulseNeighborhood] = useState('')
  const [pulseDuration,     setPulseDuration]     = useState<number>(120)  // minutes
  const [pulsing,           setPulsing]           = useState(false)

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login?next=/hangouts')
  }, [isLoading, isLoggedIn, router])

  useEffect(() => {
    if (!isLoggedIn) return
    // Two parallel loads — hangouts + active pulses — so the feed renders
    // even if one endpoint is slow. Failures fall through to empty arrays
    // so a 500 doesn't blank the page.
    Promise.allSettled([
      fetch('/app/api/hangouts',     { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/availability', { credentials: 'include' }).then(r => r.json()),
    ]).then(([h, p]) => {
      if (h.status === 'fulfilled' && Array.isArray(h.value?.hangouts)) setHangouts(h.value.hangouts)
      if (p.status === 'fulfilled' && Array.isArray(p.value?.pulses))   setPulses(p.value.pulses)
    }).finally(() => setLoading(false))
  }, [isLoggedIn])

  // Location photo upload — single image, hangouts folder. Same pattern
  // as the DM photo attach. Toast on either side so a failure isn't silent.
  async function handlePhotoChoose(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) { toast.error('Image too large (max 5MB)'); return }
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    fd.append('folder', 'hangouts')
    try {
      const r = await fetch('/app/api/upload', { method: 'POST', credentials: 'include', body: fd }).then(res => res.json())
      if (r?.url) setPhoto(r.url)
      else toast.error(r?.error ?? 'Upload failed')
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function reloadFeed() {
    const [h, p] = await Promise.allSettled([
      fetch('/app/api/hangouts',     { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/availability', { credentials: 'include' }).then(r => r.json()),
    ])
    if (h.status === 'fulfilled' && Array.isArray(h.value?.hangouts)) setHangouts(h.value.hangouts)
    if (p.status === 'fulfilled' && Array.isArray(p.value?.pulses))   setPulses(p.value.pulses)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !location.trim()) { toast.error('Title and location are required'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/app/api/hangouts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, location, neighborhood: neighborhood || undefined,
          description: description || undefined,
          startsAt: new Date(startsAt).toISOString(),
          endsAt:   new Date(endsAt).toISOString(),
          meetMode,
          photo: photo || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Could not post'); return }
      toast.success('Hangout posted — neighbors are getting pinged')
      await reloadFeed()
      setShowForm(false)
      setTitle(''); setLocation(''); setNeighborhood(''); setDescription('')
      setStartsAt(defaultStartsAt()); setEndsAt(defaultEndsAt()); setMeetMode('group')
      setPhoto(null)
    } catch {
      toast.error('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  // "I'm around" pulse — short-lived intent ping, no time/place commitment.
  async function handlePulse(e: React.FormEvent) {
    e.preventDefault()
    setPulsing(true)
    try {
      const res = await fetch('/app/api/availability', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          neighborhood: pulseNeighborhood || undefined,
          note:         pulseNote || undefined,
          untilMinutes: pulseDuration,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Could not post'); return }
      toast.success('Pulse posted — visible until it expires')
      await reloadFeed()
      setShowPulseForm(false)
      setPulseNote(''); setPulseNeighborhood(''); setPulseDuration(120)
    } catch {
      toast.error('Network error')
    } finally {
      setPulsing(false)
    }
  }

  async function handleClearPulse() {
    if (!confirm('Clear your pulse?')) return
    const res = await fetch('/app/api/availability', { method: 'DELETE', credentials: 'include' })
    if (res.ok) {
      setPulses(prev => prev.filter(p => !p.isMine))
      toast.success('Pulse cleared')
    } else {
      toast.error('Could not clear')
    }
  }

  async function handleCancel(id: string) {
    if (!confirm('Cancel this hangout?')) return
    const res = await fetch(`/app/api/hangouts/${id}`, { method: 'DELETE', credentials: 'include' })
    if (res.ok) {
      setHangouts(prev => prev.filter(h => h.id !== id))
      toast.success('Cancelled')
    } else {
      toast.error('Could not cancel')
    }
  }

  if (isLoading || !isLoggedIn) return null

  return (
    <div className="min-h-screen bg-warm pb-16">
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-8 pb-6">
          {/* Header — stacks vertically on mobile so the two action buttons
              get a full row of their own (side by side, equal width).
              Desktop keeps the original side-by-side title/actions layout. */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-3 mb-1">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-1">Spontaneous</p>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">Hangouts</h1>
              <p className="text-sm text-gray-500 mt-1">&quot;I&apos;m at X right now — join me?&quot;</p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto sm:shrink-0">
              {/* Recap entry point — anyone who's had a recent hangout can
                  leave references here. The recap push deep-links to the
                  same page; this gives a way in for users who tapped past
                  the push but still want to leave one. Hidden on mobile to
                  keep the action row to two equal-width buttons; phone
                  users get here via the recap push notification instead. */}
              <Link href="/hangouts/recap"
                className="hidden sm:inline-flex text-xs font-semibold text-gray-600 hover:text-amber-600 px-3 py-2 rounded-xl border border-gray-200 hover:border-amber-300 transition-colors">
                Recap
              </Link>
              {/* Pulse trigger — soft commitment. flex-1 on mobile so it
                  splits the row 50/50 with Post one; sm:flex-initial on
                  desktop so it sits at content width like before. */}
              <button onClick={() => { setShowPulseForm(s => !s); setShowForm(false) }}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-3 py-2 text-amber-600 border border-amber-300 hover:bg-amber-50 text-sm font-bold rounded-xl transition-colors">
                {showPulseForm ? '× Close' : '✦ I’m around'}
              </button>
              <button onClick={() => { setShowForm(s => !s); setShowPulseForm(false) }}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
                {showForm ? '× Close' : '＋ Post one'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {showForm && (
          <form onSubmit={handleSubmit} className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4 shadow-sm">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">What&apos;s happening?</label>
              <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120}
                placeholder="Coffee at Moda İskele" className="input" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Where</label>
              <input value={location} onChange={e => setLocation(e.target.value)} maxLength={200}
                placeholder="Café name, address, or Maps link" className="input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">From</label>
                <input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} className="input" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Until</label>
                <input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} min={startsAt} className="input" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Neighborhood <span className="text-gray-400 font-normal">(pings nearby members)</span>
              </label>
              <select value={neighborhood} onChange={e => setNeighborhood(e.target.value)} className="input bg-white">
                <option value="">— Not specified —</option>
                {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            {/* Intent — 'group' is the default (broadest reach). 'solo' is
                the "looking for one person" signal that joiners use to
                self-select before they tap Going. */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Vibe</label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { v: 'group', label: 'Open to whoever', sub: 'Bring others' },
                  { v: 'solo',  label: 'Just one person', sub: '1-on-1' },
                ] as const).map(opt => (
                  <button key={opt.v} type="button" onClick={() => setMeetMode(opt.v)}
                    className={`px-3 py-2.5 rounded-xl text-left border transition-colors ${
                      meetMode === opt.v
                        ? 'bg-amber-50 border-amber-400 ring-1 ring-amber-200'
                        : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}>
                    <p className="text-sm font-semibold text-gray-900">{opt.label}</p>
                    <p className="text-xs text-gray-500">{opt.sub}</p>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Note <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={500} rows={2}
                placeholder="What you're up for — quiet work, chatty, walk after…"
                className="input resize-none" />
            </div>
            {/* Location photo — optional. Helps people find the group at busy
                venues ("we're at the back table next to the window"). */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Photo of the spot <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              {photo ? (
                <div className="relative inline-block">
                  <img src={resolveImageUrl(photo)} alt="Hangout spot" className="w-32 h-32 object-cover rounded-xl border border-gray-200" />
                  <button type="button" onClick={() => setPhoto(null)}
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-gray-900 text-white text-xs hover:bg-red-500 shadow">
                    ✕
                  </button>
                </div>
              ) : (
                <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 border-dashed rounded-xl cursor-pointer text-sm font-semibold text-gray-600">
                  📷 {uploading ? 'Uploading…' : 'Add photo'}
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoChoose} disabled={uploading} />
                </label>
              )}
            </div>
            <button type="submit" disabled={submitting || uploading}
              className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
              {submitting ? 'Posting…' : 'Post hangout'}
            </button>
          </form>
        )}

        {/* Pulse form — soft commitment, no specific venue or time. Cheaper
            to fill out so people actually do it during quiet windows. */}
        {showPulseForm && (
          <form onSubmit={handlePulse} className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-4">
            <div>
              <p className="text-sm font-bold text-amber-900">I&apos;m around</p>
              <p className="text-xs text-amber-700 mt-0.5">Lightweight ping — no venue or time committed. Auto-expires.</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Note <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input value={pulseNote} onChange={e => setPulseNote(e.target.value)} maxLength={200}
                placeholder="Free for coffee · Open to drinks later · Working from a café…"
                className="input" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Where</label>
                <select value={pulseNeighborhood} onChange={e => setPulseNeighborhood(e.target.value)} className="input bg-white">
                  <option value="">— Anywhere —</option>
                  {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">For how long</label>
                <select value={pulseDuration} onChange={e => setPulseDuration(parseInt(e.target.value, 10))} className="input bg-white">
                  <option value={60}>1 hour</option>
                  <option value={120}>2 hours</option>
                  <option value={180}>3 hours</option>
                  <option value={240}>4 hours (max)</option>
                </select>
              </div>
            </div>
            <button type="submit" disabled={pulsing}
              className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
              {pulsing ? 'Posting…' : 'Drop pulse'}
            </button>
          </form>
        )}

        {/* Filter chips — local to the feed, no server round-trip. 'All'
            is the default; selecting solo/group narrows the hangouts. The
            pulse pill is read-only (you can't filter to pulses-only since
            they're a separate signal class). */}
        {!loading && (hangouts.length > 0 || pulses.length > 0) && (
          <div className="flex items-center gap-2 -mt-2 overflow-x-auto">
            {([
              { v: 'all',   label: 'All' },
              { v: 'group', label: 'Open to all' },
              { v: 'solo',  label: 'Solo only' },
            ] as { v: ModeFilter; label: string }[]).map(opt => (
              <button key={opt.v} onClick={() => setModeFilter(opt.v)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                  modeFilter === opt.v
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
                }`}>
                {opt.label}
              </button>
            ))}
            {pulses.length > 0 && (
              <span className="text-xs text-amber-700 font-semibold px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 whitespace-nowrap ml-auto">
                {pulses.length} {pulses.length === 1 ? 'pulse' : 'pulses'} active
              </span>
            )}
          </div>
        )}

        {loading ? (
          <p className="text-center text-gray-400 text-sm py-10">Loading…</p>
        ) : (() => {
          const filtered = modeFilter === 'all' ? hangouts : hangouts.filter(h => h.meetMode === modeFilter)

          if (filtered.length === 0 && pulses.length === 0) {
            return (
              <div className="text-center py-16">
                <div className="text-5xl mb-3">☕</div>
                <p className="text-base font-bold text-gray-900 mb-1">
                  {modeFilter === 'all' ? 'Nothing right now' : `No ${modeFilter === 'solo' ? 'solo' : 'group'} hangouts`}
                </p>
                <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
                  Be the first — post where you are or just drop a pulse if you don&apos;t want to commit to a venue yet.
                </p>
                <div className="flex items-center justify-center gap-2">
                  <button onClick={() => setShowPulseForm(true)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-amber-700 border border-amber-300 hover:bg-amber-50 text-sm font-bold rounded-xl">
                    ✦ I&apos;m around
                  </button>
                  <button onClick={() => setShowForm(true)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl">
                    Post a hangout
                  </button>
                </div>
              </div>
            )
          }

          return (
            <>
              {/* Pulse strip — compact cards above the full hangouts so they
                  feel like a different signal grade (lower commitment). */}
              {pulses.length > 0 && (
                <div className="space-y-2">
                  {pulses.map(p => (
                    <PulseCard key={p.id} pulse={p} onClear={p.isMine ? handleClearPulse : undefined} />
                  ))}
                </div>
              )}
              {filtered.length > 0 && (
                <div className="space-y-3">
                  {filtered.map(h => (
                    <HangoutCard
                      key={h.id}
                      h={h}
                      currentUserId={user.id}
                      onCancel={handleCancel}
                      onMutated={updated => {
                        setHangouts(prev => prev.map(pp => pp.id === updated.id ? updated : pp))
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          )
        })()}

      </div>
    </div>
  )
}

function HangoutCard({ h, currentUserId, onCancel, onMutated }: {
  h: Hangout
  currentUserId: string
  onCancel: (id: string) => void
  onMutated: (h: Hangout) => void
}) {
  const isOwner = h.user.id === currentUserId
  const avatar  = resolveImageUrl(h.user.profilePhoto)
  const [threadOpen, setThreadOpen]     = useState(false)
  const [messages,   setMessages]       = useState<HangoutMessage[]>([])
  const [draft,      setDraft]          = useState('')
  const [sending,    setSending]        = useState(false)
  const [joining,    setJoining]        = useState(false)
  const [loadingMsg, setLoadingMsg]     = useState(false)

  // Lazy-load messages the first time the thread is opened.
  useEffect(() => {
    if (!threadOpen || messages.length > 0) return
    setLoadingMsg(true)
    fetch(`/app/api/hangouts/${h.id}/messages`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setMessages(Array.isArray(d.messages) ? d.messages : []))
      .catch(() => {})
      .finally(() => setLoadingMsg(false))
  }, [threadOpen, h.id, messages.length])

  async function toggleJoin() {
    if (isOwner) return
    setJoining(true)
    try {
      const res = await fetch(`/app/api/hangouts/${h.id}/join`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Could not update'); return }
      // Update locally — count + avatar strip + my-join flip
      const me: JoinerSummary = { id: currentUserId, name: '', color: '#f59e0b', profilePhoto: null }
      onMutated({
        ...h,
        joinedByMe: data.joined,
        joiners: data.joined
          ? [...h.joiners, me]
          : h.joiners.filter(j => j.id !== currentUserId),
      })
    } finally { setJoining(false) }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.trim()) return
    setSending(true)
    try {
      const res = await fetch(`/app/api/hangouts/${h.id}/messages`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ body: draft }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Could not send'); return }
      setMessages(prev => [...prev, data.message])
      setDraft('')
      onMutated({ ...h, messageCount: h.messageCount + 1 })
    } finally { setSending(false) }
  }

  const photoUrl = h.photo ? resolveImageUrl(h.photo) : null
  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
      {/* Location photo — full-bleed at top so it reads as "this is where
          we're meeting" rather than a small decorative thumbnail. */}
      {photoUrl && (
        <Link href={`/hangouts/${h.id}`} className="block">
          <img src={photoUrl} alt={h.title} className="w-full h-40 object-cover" />
        </Link>
      )}
      <div className="p-4">
      <div className="flex items-start gap-3">
        {avatar
          ? <img src={avatar} alt={h.user.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
          : <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
              style={{ backgroundColor: h.user.color }}>{h.user.name[0]}</div>}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <Link href={`/hangouts/${h.id}`} className="text-sm font-bold text-gray-900 leading-snug hover:text-amber-700">{h.title}</Link>
            {/* Intent badge — only renders for 'solo' since 'group' is the
                default and adding "open to all" everywhere is noise. */}
            {h.meetMode === 'solo' && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 text-[10px] font-semibold border border-purple-200 shrink-0">
                1-on-1
              </span>
            )}
          </div>
          <p className="text-xs text-amber-700 font-semibold mt-0.5">{formatWindow(h.startsAt, h.endsAt)}</p>
          <p className="text-xs text-gray-600 mt-1.5">📍 {h.location}{h.neighborhood && <span className="text-gray-400"> · {h.neighborhood}</span>}</p>
          {h.description && (
            <p className="text-xs text-gray-500 mt-2 whitespace-pre-wrap">{h.description}</p>
          )}
          <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-1.5 flex-wrap">
            <span>Posted by {isOwner ? 'you' : h.user.name}</span>
            {/* Trust badge — sourced from HangoutReference aggregates. Only
                shows once a host has at least one good reference so it
                doesn't make newcomers look unproven by absence. */}
            {!isOwner && (h.user.goodHangouts ?? 0) > 0 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 text-[10px] font-semibold border border-green-200">
                ✓ {h.user.goodHangouts} good hangout{h.user.goodHangouts === 1 ? '' : 's'}
              </span>
            )}
          </p>
        </div>
        {isOwner && (
          <button onClick={() => onCancel(h.id)}
            className="text-xs text-gray-400 hover:text-red-500 shrink-0">Cancel</button>
        )}
      </div>

      {/* Going + chat actions row */}
      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-gray-100">
        {/* Avatar strip — counts host as implicitly in */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <div className="flex -space-x-1.5">
            {[h.user, ...h.joiners.filter(j => j.id !== h.user.id)].slice(0, 4).map(j => (
              j.profilePhoto
                ? <img key={j.id} src={resolveImageUrl(j.profilePhoto)} alt="" className="w-6 h-6 rounded-full border-2 border-white object-cover" />
                : <div key={j.id} className="w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-white text-[9px] font-bold"
                    style={{ backgroundColor: j.color }}>{j.name[0] ?? '?'}</div>
            ))}
          </div>
          <span className="text-xs text-gray-500 truncate">
            {h.joiners.length === 0
              ? 'No one in yet'
              : `${h.joiners.length + 1} going`}
          </span>
        </div>

        {!isOwner && (
          <button onClick={toggleJoin} disabled={joining}
            className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors shrink-0 ${
              h.joinedByMe
                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                : 'bg-amber-500 text-white hover:bg-amber-600'
            }`}>
            {h.joinedByMe ? 'You’re in ✓' : "I’m in"}
          </button>
        )}

        <button onClick={() => setThreadOpen(o => !o)}
          className="text-xs font-semibold text-gray-500 hover:text-gray-900 shrink-0 flex items-center gap-1">
          💬 {h.messageCount > 0 && <span>{h.messageCount}</span>}
        </button>
      </div>

      {/* Comment thread */}
      {threadOpen && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
          {loadingMsg ? (
            <p className="text-xs text-gray-400 text-center py-2">Loading…</p>
          ) : messages.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-2">No messages yet — be the first.</p>
          ) : (
            messages.map(m => (
              <div key={m.id} className="flex items-start gap-2">
                {m.user.profilePhoto
                  ? <img src={resolveImageUrl(m.user.profilePhoto)} alt="" className="w-6 h-6 rounded-full object-cover shrink-0" />
                  : <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                      style={{ backgroundColor: m.user.color }}>{m.user.name[0]}</div>}
                <div className="flex-1 min-w-0">
                  <p className="text-xs"><span className="font-semibold text-gray-900">{m.user.name}</span> <span className="text-gray-400">· {new Date(m.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{m.body}</p>
                </div>
              </div>
            ))
          )}
          <form onSubmit={sendMessage} className="flex items-center gap-2 pt-1">
            <input value={draft} onChange={e => setDraft(e.target.value)} maxLength={1000}
              placeholder="Running 10min late…" className="flex-1 input text-sm" />
            <button type="submit" disabled={sending || !draft.trim()}
              className="text-xs font-bold bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white px-3 py-2 rounded-xl">
              Send
            </button>
          </form>
        </div>
      )}
      </div>{/* close p-4 wrapper that hosts everything below the photo */}
    </div>
  )
}

// PulseCard — compact card for an AvailabilityPulse. Visually lighter than a
// hangout card so the two signal grades read differently at a glance.
function PulseCard({ pulse, onClear }: { pulse: Pulse; onClear?: () => void }) {
  const avatar = pulse.user.profilePhoto ? resolveImageUrl(pulse.user.profilePhoto) : null
  const minsLeft = Math.max(0, Math.round((new Date(pulse.until).getTime() - Date.now()) / 60_000))
  const ttlLabel = minsLeft < 60 ? `${minsLeft}m left` : `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m left`

  return (
    <div className={`rounded-2xl border p-3 flex items-center gap-3 ${
      pulse.isMine ? 'bg-amber-50 border-amber-200' : 'bg-white border-amber-100'
    }`}>
      {avatar
        ? <img src={avatar} alt={pulse.user.name} className="w-9 h-9 rounded-full object-cover shrink-0" />
        : <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
            style={{ backgroundColor: pulse.user.color }}>{pulse.user.name[0]}</div>}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">
          ✦ {pulse.user.name} {pulse.isMine && <span className="text-amber-500">(you)</span>} is around
        </p>
        <p className="text-sm text-gray-900 truncate mt-0.5">
          {pulse.note || 'Open to meeting up'}
          {pulse.neighborhood && <span className="text-gray-500"> · {pulse.neighborhood}</span>}
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5">{ttlLabel}</p>
      </div>
      {pulse.isMine ? (
        <button onClick={onClear} className="text-xs text-gray-400 hover:text-red-500 shrink-0">Clear</button>
      ) : (
        <Link href={`/messages/${pulse.user.id}`}
          className="text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg shrink-0">
          Message
        </Link>
      )}
    </div>
  )
}
