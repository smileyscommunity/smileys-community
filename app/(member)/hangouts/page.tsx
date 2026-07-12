'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { ISTANBUL_NEIGHBORHOODS, resolveImageUrl, avatarUrl, getInitials } from '@/lib/data'
import { countryFlag } from '@/lib/countries'
import { toast } from 'sonner'
import { downscaleImage } from '@/lib/image-resize'

// Spontaneous hangouts — members only (real-time, contact-required). Auto-
// expires server-side via the cron when endsAt is past.

interface JoinerSummary {
  id: string; name: string; color: string; profilePhoto: string | null
  nationality?:       string | null
  goodHangouts?:      number
  languages?:         string[]
  mutualConnections?: number
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

interface Regular {
  id:           string
  name:         string
  color:        string
  profilePhoto: string | null
  neighborhood: string | null
  count:        number
}

interface RecentHangout {
  id:           string
  title:        string
  neighborhood: string | null
  endsAt:       string
  user:         { id: string; name: string; color: string; profilePhoto: string | null }
  joinerCount:  number
  goodRefCount: number
}

type ModeFilter = 'all' | 'solo' | 'group'

interface HangoutMessage {
  id:        string
  body:      string
  createdAt: string
  user:      JoinerSummary
}

// Hangout times are always shown in Istanbul time, never the viewer's
// device timezone — the community is Istanbul-based, so a member abroad
// (or with a misconfigured device clock) still sees the local meet time.
const TZ = 'Europe/Istanbul'
function formatWindow(startsAt: string, endsAt: string) {
  const s = new Date(startsAt)
  const e = new Date(endsAt)
  const now = new Date()
  const minsToStart = Math.round((s.getTime() - now.getTime()) / 60_000)

  const fmtTime = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
  // Day comparisons in Istanbul, not the device tz.
  const istDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })

  let prefix = ''
  if (minsToStart < 0)        prefix = 'Now · '
  else if (minsToStart < 60)  prefix = `In ${minsToStart}m · `
  else if (istDay(s) === istDay(now)) prefix = 'Today · '
  else                        prefix = s.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }) + ' · '

  return `${prefix}${fmtTime(s)}–${fmtTime(e)}`
}

// The datetime-local input represents ISTANBUL wall-clock time (the
// hangout's meet time), not the creator's device time. Format the default
// as Istanbul wall-clock so the input + the stored value stay consistent
// regardless of where the creator's device clock is. sv-SE → "YYYY-MM-DD
// HH:MM:SS"; swap the space for T and drop seconds.
function toIstanbulInputValue(d: Date): string {
  return d.toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T').slice(0, 16)
}
// Inverse: a datetime-local value ("YYYY-MM-DDTHH:MM") is the Istanbul
// wall-clock meet time. Turkey is UTC+3 year-round (no DST since 2016, the
// same assumption the event pages make), so tag it +03:00 to get the correct
// UTC instant regardless of the creator's device timezone.
function istanbulInputToISO(local: string): string {
  return new Date(`${local}:00+03:00`).toISOString()
}
function defaultStartsAt(): string {
  // 15 min from now, rounded — covers "I'm walking there"
  const d = new Date(Date.now() + 15 * 60_000)
  d.setSeconds(0, 0)
  return toIstanbulInputValue(d) // YYYY-MM-DDTHH:MM (Istanbul)
}
function defaultEndsAt(): string {
  // 2 hours after default start — typical café hangout window
  const d = new Date(Date.now() + 2 * 60 * 60_000 + 15 * 60_000)
  d.setSeconds(0, 0)
  return toIstanbulInputValue(d)
}

export default function HangoutsPage() {
  const router = useRouter()
  const { user, isLoggedIn, isLoading } = useAuth()

  const [hangouts,       setHangouts]       = useState<Hangout[]>([])
  const [pulses,         setPulses]         = useState<Pulse[]>([])
  const [recentHangouts, setRecentHangouts] = useState<RecentHangout[]>([])
  const [regulars,       setRegulars]       = useState<Regular[]>([])
  const [recapCount,     setRecapCount]     = useState(0)
  const [loading,        setLoading]        = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showPulseForm, setShowPulseForm] = useState(false)
  // Filter chips — exclusive: meet-mode + neighborhood. Toggleable: language.
  // All default to "off" / "all" so newcomers see the full feed by default;
  // filters are an explicit narrowing action.
  const [modeFilter,          setModeFilter]          = useState<ModeFilter>('all')
  const [neighborhoodFilter,  setNeighborhoodFilter]  = useState<string | null>(null)
  const [languageOnly,        setLanguageOnly]        = useState(false)

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

  // Quick-start presets — one tap prefills the post form so hosting from an
  // empty feed feels effortless. Time defaults to the usual near-now window;
  // the host still picks the spot + neighborhood.
  const QUICK_STARTS = [
    { emoji: '☕', label: 'Coffee',  title: 'Coffee ☕',            description: 'Grabbing a coffee — come hang.' },
    { emoji: '🍺', label: 'Drinks',  title: 'After-work drinks 🍺', description: 'Unwinding with a drink — join in.' },
    { emoji: '🚶', label: 'Walk',    title: 'Evening walk 🚶',      description: 'Going for a walk — come along.' },
    { emoji: '🍽️', label: 'Food',    title: 'Grabbing food 🍽️',    description: 'Getting a bite — pull up a chair.' },
    { emoji: '🎲', label: 'Games',   title: 'Board games 🎲',       description: 'Playing some games — bring your competitive side.' },
    { emoji: '💻', label: 'Cowork',  title: 'Coworking 💻',         description: 'Working from a café — join for focused company.' },
  ]
  function quickStart(p: { title: string; description: string }) {
    setTitle(p.title)
    setDescription(p.description)
    setMeetMode('group')
    setStartsAt(defaultStartsAt())
    setEndsAt(defaultEndsAt())
    setShowPulseForm(false)
    setShowForm(true)
  }

  // Pulse form
  const [pulseNote,         setPulseNote]         = useState('')
  const [pulseNeighborhood, setPulseNeighborhood] = useState('')
  const [pulseDuration,     setPulseDuration]     = useState<number>(120)  // minutes
  const [pulsing,           setPulsing]           = useState(false)

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login?next=/hangouts')
  }, [isLoading, isLoggedIn, router])

  // Single source for the two parallel fetches that build the feed.
  // Mount + post-action reloads now share this; was duplicated as
  // mount-effect + reloadFeed() with identical Promise.allSettled
  // bodies. Failures fall through to whatever state was already
  // set, so a 500 from one endpoint doesn't blank the page.
  async function loadFeed() {
    const [h, p, rc, rh, rg] = await Promise.allSettled([
      fetch('/app/api/hangouts',             { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/availability',         { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/hangouts/recap-count', { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/hangouts/recent',      { credentials: 'include' }).then(r => r.json()),
      fetch('/app/api/hangouts/regulars',    { credentials: 'include' }).then(r => r.json()),
    ])
    if (h.status  === 'fulfilled' && Array.isArray(h.value?.hangouts))      setHangouts(h.value.hangouts)
    if (p.status  === 'fulfilled' && Array.isArray(p.value?.pulses))        setPulses(p.value.pulses)
    if (rc.status === 'fulfilled' && typeof rc.value?.pending === 'number') setRecapCount(rc.value.pending)
    if (rh.status === 'fulfilled' && Array.isArray(rh.value?.hangouts))     setRecentHangouts(rh.value.hangouts)
    if (rg.status === 'fulfilled' && Array.isArray(rg.value?.regulars))     setRegulars(rg.value.regulars)
  }

  useEffect(() => {
    if (!isLoggedIn) return
    loadFeed().finally(() => setLoading(false))
    // loadFeed closes over the setters which are stable; safe to
    // omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn])

  // Location photo upload — single image, hangouts folder. Same pattern
  // as the DM photo attach. Toast on either side so a failure isn't silent.
  async function handlePhotoChoose(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const upload = await downscaleImage(file)
    const fd = new FormData()
    fd.append('file', upload)
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !location.trim()) { toast.error('Title and location are required'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/app/api/hangouts', {
        method:  'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title, location, neighborhood: neighborhood || undefined,
          description: description || undefined,
          startsAt: istanbulInputToISO(startsAt),
          endsAt:   istanbulInputToISO(endsAt),
          meetMode,
          photo: photo || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Could not post'); return }
      toast.success('Hangout posted — neighbors are getting pinged')
      await loadFeed()
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
        credentials: 'include',
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
      await loadFeed()
      setShowPulseForm(false)
      setPulseNote(''); setPulseNeighborhood(''); setPulseDuration(120)
    } catch {
      toast.error('Network error')
    } finally {
      setPulsing(false)
    }
  }

  // Confirmation is now handled inline by PulseCard's two-state UI; the
  // parent just executes the DELETE when called.
  async function handleClearPulse() {
    try {
      const res = await fetch('/app/api/availability', { method: 'DELETE', credentials: 'include' })
      if (!res.ok) {
        toast.error('Could not clear')
        return
      }
      setPulses(prev => prev.filter(p => !p.isMine))
      toast.success('Pulse cleared')
    } catch {
      toast.error('Network error — check your connection')
    }
  }

  // Confirmation is handled inline by HangoutCard's two-state UI.
  async function handleCancel(id: string) {
    try {
      const res = await fetch(`/app/api/hangouts/${id}`, { method: 'DELETE', credentials: 'include' })
      if (!res.ok) {
        toast.error('Could not cancel')
        return
      }
      setHangouts(prev => prev.filter(h => h.id !== id))
      toast.success('Cancelled')
    } catch {
      toast.error('Network error — check your connection')
    }
  }

  if (isLoading || !isLoggedIn) return null

  return (
    <div className="min-h-screen bg-warm pb-16">
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-6">
          <div className="max-w-3xl">
          {/* Header — stacks vertically on mobile so the two action buttons
              get a full row of their own (side by side, equal width).
              Desktop keeps the original side-by-side title/actions layout. */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-3 mb-1">
            <div>
              <span className="inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">☕ Spontaneous</span>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900">Hangouts</h1>
              <p className="text-base text-gray-600 mt-1">&quot;I&apos;m at X right now — join me?&quot;</p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto sm:shrink-0">
              {/* Recap entry point — anyone who's had a recent hangout can
                  leave references here. The recap push deep-links to the
                  same page; this gives a way in for users who tapped past
                  the push but still want to leave one. Hidden on mobile to
                  keep the action row to two equal-width buttons; phone
                  users get here via the recap push notification instead. */}
              {/* Pulse trigger — soft commitment. flex-1 on mobile so it
                  splits the row 50/50 with Post one; sm:flex-initial on
                  desktop so it sits at content width like before. */}
              <button onClick={() => { setShowPulseForm(s => !s); setShowForm(false) }}
                aria-expanded={showPulseForm}
                className="flex-1 sm:flex-initial flex flex-col items-center justify-center px-3 py-2 text-amber-600 border border-amber-300 hover:bg-amber-50 rounded-xl transition-colors">
                {showPulseForm ? <span className="text-sm font-bold">× Close</span> : <>
                  <span className="text-sm font-bold">✦ I’m around</span>
                  <span className="text-[10px] font-normal text-amber-500 mt-0.5">No plan, just free</span>
                </>}
              </button>
              <button onClick={() => { setShowForm(s => !s); setShowPulseForm(false) }}
                aria-expanded={showForm}
                className="flex-1 sm:flex-initial flex flex-col items-center justify-center px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl transition-colors">
                {showForm ? <span className="text-sm font-bold">× Close</span> : <>
                  <span className="text-sm font-bold">＋ Post a hangout</span>
                  <span className="text-[10px] font-normal text-amber-100 mt-0.5">I’m at X — come join</span>
                </>}
              </button>
            </div>
          </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="max-w-3xl space-y-6">

        {/* Recap nudge — only shows when the user has past hangouts waiting
            for a reference. Explains what recap is so it doesn't feel random. */}
        {recapCount > 0 && (
          <Link href="/hangouts/recap"
            className="flex items-center justify-between gap-3 bg-white border border-amber-200 rounded-2xl px-5 py-4 shadow-sm hover:border-amber-400 transition-colors">
            <div className="min-w-0">
              <p className="text-sm font-bold text-gray-900">
                ⭐ {recapCount} hangout{recapCount === 1 ? '' : 's'} waiting for your review
              </p>
              <p className="text-xs text-gray-500 mt-0.5">Leave a reference for people you met — it builds trust for their next hangout.</p>
            </div>
            <span className="text-xs font-bold text-amber-600 shrink-0">Review →</span>
          </Link>
        )}

        {/* Ground rules — always visible so everyone knows the norms, not
            just people who happen to open the post form. */}
        <div className="rounded-2xl border border-amber-100 bg-amber-50 px-5 py-4">
          <p className="text-xs font-bold text-amber-800 uppercase tracking-widest mb-3">Ground rules</p>
          <ul className="space-y-2">
            <li className="flex items-start gap-2 text-xs text-amber-900"><span>📍</span><span>Meet in public places only — no private addresses.</span></li>
            <li className="flex items-start gap-2 text-xs text-amber-900"><span>🚫</span><span>Cancel if plans change — don't leave joiners hanging.</span></li>
            <li className="flex items-start gap-2 text-xs text-amber-900"><span>🔁</span><span>No recurring events or commercial meetups — those go on the Events page.</span></li>
            <li className="flex items-start gap-2 text-xs text-amber-900"><span>⭐</span><span>After it ends, leave a recap so hosts build trust over time.</span></li>
          </ul>
        </div>

        {/* Quick-start prompts — one tap prefills + opens the post form so
            hosting from an empty feed feels effortless. */}
        {!showForm && !showPulseForm && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 px-1">Start something quick</p>
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {QUICK_STARTS.map(p => (
                <button key={p.label} onClick={() => quickStart(p)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white border border-gray-200 hover:border-amber-400 hover:bg-amber-50 text-sm font-semibold text-gray-700 whitespace-nowrap shrink-0 transition-colors">
                  <span>{p.emoji}</span> {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {showForm && (
          <form onSubmit={handleSubmit} className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4 shadow-sm">
            {/* Labels wrap their inputs so the association is implicit
                (no htmlFor/id pair needed). SR users tabbing into any
                field now hear the label announced. */}
            <label className="block">
              <span className="block text-sm font-semibold text-gray-700 mb-1.5">What&apos;s happening?</span>
              <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120}
                placeholder="Coffee at Moda İskele" className="input" />
            </label>
            <label className="block">
              <span className="block text-sm font-semibold text-gray-700 mb-1.5">Where</span>
              <input value={location} onChange={e => setLocation(e.target.value)} maxLength={200}
                placeholder="Café name, address, or Maps link" className="input" />
            </label>
            {/* Stack on mobile — native datetime-local inputs reserve a
                fixed width for their date+time controls and overflow a
                2-col grid on phones, causing the two fields to overlap. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-sm font-semibold text-gray-700 mb-1.5">From</span>
                <input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} className="input w-full" />
              </label>
              <label className="block">
                <span className="block text-sm font-semibold text-gray-700 mb-1.5">Until</span>
                <input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} min={startsAt} className="input w-full" />
              </label>
            </div>
            <label className="block">
              <span className="block text-sm font-semibold text-gray-700 mb-1.5">
                Neighborhood <span className="text-gray-400 font-normal">(pings nearby members)</span>
              </span>
              <select value={neighborhood} onChange={e => setNeighborhood(e.target.value)} className="input bg-white">
                <option value="">— Not specified —</option>
                {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
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
                    <p className="text-xs text-gray-600">{opt.sub}</p>
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="block text-sm font-semibold text-gray-700 mb-1.5">
                Note <span className="text-gray-400 font-normal">(optional)</span>
              </span>
              <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={500} rows={2}
                placeholder="What you're up for — quiet work, chatty, walk after…"
                className="input resize-none" />
            </label>
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
            <label className="block">
              <span className="block text-sm font-semibold text-gray-700 mb-1.5">
                Note <span className="text-gray-400 font-normal">(optional)</span>
              </span>
              <input value={pulseNote} onChange={e => setPulseNote(e.target.value)} maxLength={200}
                placeholder="Free for coffee · Open to drinks later · Working from a café…"
                className="input" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-sm font-semibold text-gray-700 mb-1.5">Where</span>
                <select value={pulseNeighborhood} onChange={e => setPulseNeighborhood(e.target.value)} className="input bg-white">
                  <option value="">— Anywhere —</option>
                  {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-sm font-semibold text-gray-700 mb-1.5">For how long</span>
                <select value={pulseDuration} onChange={e => setPulseDuration(parseInt(e.target.value, 10))} className="input bg-white">
                  <option value={60}>1 hour</option>
                  <option value={120}>2 hours</option>
                  <option value={180}>3 hours</option>
                  <option value={240}>4 hours (max)</option>
                </select>
              </label>
            </div>
            <button type="submit" disabled={pulsing}
              className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
              {pulsing ? 'Posting…' : 'Drop pulse'}
            </button>
          </form>
        )}

        {/* Filter chips — local to the feed, no server round-trip. The
            meet-mode chips are exclusive (All / Open to all / Solo only);
            the neighborhood + language toggles stack independently so a
            user can mix any combination. Hidden when there's nothing to
            filter. */}
        {!loading && (hangouts.length > 0 || pulses.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 -mt-2 pb-1">
            {/* Mode chips are an exclusive single-select — semantic tabs
                with role=tab + aria-selected so SR users navigate them
                as tabs rather than three unrelated buttons. The chips
                live in a tablist alongside the toggle chips below, but
                only the mode chips share the role=tab semantics; the
                toggles are independent on/off filters and use
                aria-pressed instead. */}
            <div role="tablist" aria-label="Filter hangouts by meet mode" className="contents">
              {([
                { v: 'all',   label: 'All' },
                { v: 'group', label: 'Open to all' },
                { v: 'solo',  label: 'Solo only' },
              ] as { v: ModeFilter; label: string }[]).map(opt => (
                <button
                  key={opt.v}
                  onClick={() => setModeFilter(opt.v)}
                  role="tab"
                  aria-selected={modeFilter === opt.v}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                    modeFilter === opt.v
                      ? 'bg-amber-500 text-white'
                      : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Neighborhood pills — one per distinct neighborhood in the
                current feed, sorted alphabetically. Hidden when every
                hangout is location-less or there's only one neighborhood
                (no point filtering to the only option). */}
            {(() => {
              const hoods = [...new Set(hangouts.map(h => h.neighborhood).filter(Boolean) as string[])].sort()
              if (hoods.length < 2) return null
              return hoods.map(hood => (
                <button
                  key={hood}
                  onClick={() => setNeighborhoodFilter(v => v === hood ? null : hood)}
                  aria-pressed={neighborhoodFilter === hood}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                    neighborhoodFilter === hood
                      ? 'bg-amber-500 text-white'
                      : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
                  }`}>
                  📍 {hood}
                </button>
              ))
            })()}

            {/* Language toggle — same suppression pattern: if no languages
                set on the profile, the chip would never match anything. */}
            {(user.languages?.length ?? 0) > 0 && (
              <button
                onClick={() => setLanguageOnly(v => !v)}
                aria-pressed={languageOnly}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                  languageOnly
                    ? 'bg-amber-500 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
                }`}
                title="Hosts who speak a language you do">
                🗣 My language
              </button>
            )}

            {pulses.length > 0 && (
              <span className="text-xs text-amber-700 font-semibold px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 whitespace-nowrap ml-auto">
                {pulses.length} {pulses.length === 1 ? 'pulse' : 'pulses'} active
              </span>
            )}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">{[0,1,2].map(i => (<div key={i} className="bg-white rounded-2xl shadow-card p-4 animate-pulse"><div className="flex items-center gap-3 mb-3"><div className="w-10 h-10 rounded-full bg-gray-200 shrink-0" /><div className="flex-1 space-y-2"><div className="h-3 w-1/2 bg-gray-200 rounded" /><div className="h-3 w-1/3 bg-gray-200 rounded" /></div></div><div className="h-3 w-full bg-gray-200 rounded mb-2" /><div className="h-3 w-4/5 bg-gray-200 rounded" /></div>))}</div>
        ) : (() => {
          // Apply all three filters in order. modeFilter + neighborhoodFilter
          // are exclusive single-select; language is an independent toggle.
          const myLangs = new Set(user.languages ?? [])
          const filtered = hangouts.filter(h => {
            if (modeFilter !== 'all' && h.meetMode !== modeFilter) return false
            if (neighborhoodFilter && h.neighborhood !== neighborhoodFilter) return false
            if (languageOnly) {
              const hostLangs = h.user.languages ?? []
              if (!hostLangs.some(l => myLangs.has(l))) return false
            }
            return true
          })

          if (filtered.length === 0 && pulses.length === 0) {
            const anyFilterOn = modeFilter !== 'all' || neighborhoodFilter !== null || languageOnly
            return (
              <div className="text-center py-16">
                <div aria-hidden="true" className="text-5xl mb-3">☕</div>
                <p className="text-base font-bold text-gray-900 mb-1">
                  {anyFilterOn ? 'Nothing matches your filters' : 'Nothing right now'}
                </p>
                <p className="text-sm text-gray-600 max-w-md mx-auto">
                  Use the buttons above to drop a quick pulse or post a hangout with a specific spot and time.
                </p>
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
                      currentUser={user}
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

        {/* Just happened — expired hangouts from the last 48h. Social proof
            that the feature is alive; also creates FOMO for newcomers.
            Sits above "most active hosts" so the freshest activity leads. */}
        {!loading && recentHangouts.length > 0 && (
          <div className="pt-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 px-1">Just happened</p>
            <div className="space-y-2">
              {recentHangouts.map(h => {
                const hostAvatar = h.user.profilePhoto
                  ? avatarUrl(h.user.profilePhoto, 64)
                  : null
                const hoursAgo = Math.round((Date.now() - new Date(h.endsAt).getTime()) / 3_600_000)
                return (
                  <div key={h.id} className="bg-white rounded-2xl shadow-card px-4 py-3 flex items-center gap-3 opacity-80">
                    {hostAvatar
                      ? <img src={hostAvatar} alt={h.user.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                      : <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                             style={{ backgroundColor: h.user.color }}>
                          {getInitials(h.user.name)}
                        </div>
                    }
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-700 truncate">{h.title}</p>
                      <p className="text-xs text-gray-400">
                        {h.joinerCount > 0
                          ? `${h.joinerCount + 1} went`
                          : 'Host only'
                        }
                        {h.goodRefCount > 0 && <> · ✓ {h.goodRefCount} good</>}
                        {h.neighborhood && <> · {h.neighborhood}</>}
                        {' · '}{hoursAgo < 1 ? 'just now' : `${hoursAgo}h ago`}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Regulars — top hosts this month. Social reward + newcomer signal. */}
        {!loading && regulars.length > 0 && (
          <div className="pt-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 px-1">Most active hosts this month</p>
            <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
              {regulars.map((r, i) => {
                const photo = r.profilePhoto ? avatarUrl(r.profilePhoto, 128) : null
                return (
                  <Link key={r.id} href={`/members/${r.id}`}
                        className="flex flex-col items-center gap-1.5 min-w-[64px] group">
                    <div className="relative">
                      {photo
                        ? <img src={photo} alt={r.name} className="w-14 h-14 rounded-full object-cover border-2 border-white shadow-sm group-hover:ring-2 group-hover:ring-amber-400 transition-all" />
                        : <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-sm font-bold border-2 border-white shadow-sm group-hover:ring-2 group-hover:ring-amber-400 transition-all"
                               style={{ backgroundColor: r.color }}>
                            {getInitials(r.name)}
                          </div>
                      }
                      <span className="absolute -bottom-0.5 -right-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center shadow-sm">
                        {i + 1}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-gray-700 text-center leading-tight max-w-[64px] truncate group-hover:text-amber-600 transition-colors">
                      {r.name.split(' ')[0]}
                    </p>
                    <p className="text-[10px] text-gray-400">{r.count} hosted</p>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        </div>
      </div>
    </div>
  )
}

function HangoutCard({ h, currentUser, onCancel, onMutated }: {
  h: Hangout
  // Real user from useAuth — used for ownership check + optimistic
  // join (was just `currentUserId: string`, which forced the just-
  // joined-me avatar to fall back to empty initials and a flat amber
  // circle until the next reload). profilePhoto is `string | null |
  // undefined` because useAuth's AppUser shape uses undefined; we
  // coerce to JoinerSummary's `string | null` at the optimistic add.
  currentUser: { id: string; name: string; color: string; profilePhoto?: string | null }
  onCancel: (id: string) => void
  onMutated: (h: Hangout) => void
}) {
  const isOwner = h.user.id === currentUser.id
  // #7 perf: 128-wide avatar thumb on hangouts feed (rendered at
  // w-12 = 48px CSS = retina 96px).
  const avatar  = avatarUrl(h.user.profilePhoto, 128)
  const [threadOpen, setThreadOpen]     = useState(false)
  const [messages,   setMessages]       = useState<HangoutMessage[]>([])
  const [draft,      setDraft]          = useState('')
  const [sending,    setSending]        = useState(false)
  const [joining,    setJoining]        = useState(false)
  const [loadingMsg, setLoadingMsg]     = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  // Lazy-load messages the first time the thread is opened.
  useEffect(() => {
    if (!threadOpen || messages.length > 0) return
    setLoadingMsg(true)
    fetch(`/app/api/hangouts/${h.id}/messages`, { credentials: 'include' })
      .then(r => r.json())
      .then(d => setMessages(Array.isArray(d.messages) ? d.messages : []))
      .catch(() => { toast.error('Could not load messages') })
      .finally(() => setLoadingMsg(false))
  }, [threadOpen, h.id, messages.length])

  async function shareHangout() {
    // Full permalink including the /app basePath. Native share sheet on mobile
    // (WhatsApp, Messages, …); clipboard fallback on desktop.
    const url = `${window.location.origin}/app/hangouts/${h.id}`
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: h.title, text: `Join this hangout on Smileys: ${h.title}`, url })
      } else {
        await navigator.clipboard.writeText(url)
        toast.success('Link copied!')
      }
    } catch {
      // Share sheet dismissed or clipboard blocked — no-op.
    }
  }

  async function toggleJoin() {
    if (isOwner) return
    setJoining(true)
    try {
      const res = await fetch(`/app/api/hangouts/${h.id}/join`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Could not update'); return }
      // Update locally — count + avatar strip + my-join flip
      // Optimistic add uses the real user — name + color + photo —
      // so the avatar strip shows the right initials + brand colour
      // immediately instead of an empty circle until the next reload.
      const me: JoinerSummary = {
        id:           currentUser.id,
        name:         currentUser.name,
        color:        currentUser.color,
        profilePhoto: currentUser.profilePhoto ?? null,
      }
      onMutated({
        ...h,
        joinedByMe: data.joined,
        joiners: data.joined
          ? [...h.joiners, me]
          : h.joiners.filter(j => j.id !== currentUser.id),
      })
    } catch {
      toast.error('Network error — check your connection')
    } finally { setJoining(false) }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.trim()) return
    setSending(true)
    try {
      const res = await fetch(`/app/api/hangouts/${h.id}/messages`, {
        method:  'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ body: draft }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Could not send'); return }
      setMessages(prev => [...prev, data.message])
      setDraft('')
      onMutated({ ...h, messageCount: h.messageCount + 1 })
    } catch {
      toast.error('Network error — check your connection')
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
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold border border-amber-200 shrink-0">
                1-on-1
              </span>
            )}
          </div>
          <p className="text-xs text-amber-700 font-semibold mt-0.5">{formatWindow(h.startsAt, h.endsAt)}</p>
          <p className="text-xs text-gray-600 mt-1.5">📍 {h.location}{h.neighborhood && <span className="text-gray-400"> · {h.neighborhood}</span>}</p>
          {h.description && (
            <p className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">{h.description}</p>
          )}
          <p className="text-[11px] text-gray-400 mt-2 flex items-center gap-1.5 flex-wrap">
            <span>Posted by {isOwner ? 'you' : <>{h.user.name}{countryFlag(h.user.nationality) && <> {countryFlag(h.user.nationality)}</>}</>}</span>
            {/* Trust badge — sourced from HangoutReference aggregates. Only
                shows once a host has at least one good reference so it
                doesn't make newcomers look unproven by absence. */}
            {!isOwner && (h.user.goodHangouts ?? 0) > 0 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 text-[10px] font-semibold border border-green-200">
                ✓ {h.user.goodHangouts} good hangout{h.user.goodHangouts === 1 ? '' : 's'}
              </span>
            )}
            {/* Friend-of-friend signal — softens the "stranger meets
                stranger" risk. Hidden at zero so the absence isn't a
                negative cue. */}
            {!isOwner && (h.user.mutualConnections ?? 0) > 0 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-semibold border border-blue-200">
                👥 {h.user.mutualConnections} mutual
              </span>
            )}
          </p>
        </div>
        {isOwner && (
          // Two-state inline cancel — was a native confirm() in the
          // parent. First tap flips confirmingCancel; second tap on
          // "Yes, cancel" fires the DELETE. "Keep it" cleanly aborts.
          confirmingCancel ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => { onCancel(h.id); setConfirmingCancel(false) }}
                className="text-xs font-bold text-red-600 hover:text-red-700">Yes, cancel</button>
              <span className="text-xs text-gray-300">/</span>
              <button onClick={() => setConfirmingCancel(false)}
                className="text-xs font-semibold text-gray-500 hover:text-gray-700">Keep it</button>
            </div>
          ) : (
            <button onClick={() => setConfirmingCancel(true)}
              className="text-xs text-gray-400 hover:text-gray-700 shrink-0">Cancel</button>
          )
        )}
      </div>

      {/* Going + chat actions row */}
      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-gray-100">
        {/* Avatar strip — counts host as implicitly in. Caps the visible
            row at 4 avatars; if more people are going, append a +N
            circle so the user gets a visual cue without having to read
            the "X going" text first. */}
        {(() => {
          const everyone = [h.user, ...h.joiners.filter(j => j.id !== h.user.id)]
          const VISIBLE  = 4
          const visible  = everyone.slice(0, VISIBLE)
          const overflow = Math.max(0, everyone.length - VISIBLE)
          return (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <div className="flex -space-x-1.5">
                {visible.map(j => (
                  j.profilePhoto
                    ? <img key={j.id} src={avatarUrl(j.profilePhoto, 64)} alt="" loading="lazy" decoding="async" className="w-6 h-6 rounded-full border-2 border-white object-cover" />
                    : <div key={j.id} className="w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-white text-[9px] font-bold"
                        style={{ backgroundColor: j.color }}>{j.name[0] ?? '?'}</div>
                ))}
                {overflow > 0 && (
                  <div
                    aria-label={`${overflow} more`}
                    className="w-6 h-6 rounded-full border-2 border-white bg-gray-100 text-gray-700 text-[9px] font-bold flex items-center justify-center">
                    +{overflow}
                  </div>
                )}
              </div>
              <span className="text-xs text-gray-600 truncate">
                {h.joiners.length + 1} going
              </span>
            </div>
          )
        })()}

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
          aria-label="Toggle comments" aria-expanded={threadOpen}
          className="text-xs font-semibold text-gray-600 hover:text-gray-900 shrink-0 flex items-center gap-1">
          💬 {h.messageCount > 0 && <span>{h.messageCount}</span>}
        </button>

        <button onClick={shareHangout}
          aria-label="Share hangout" title="Share"
          className="text-xs font-semibold text-gray-600 hover:text-gray-900 shrink-0">
          🔗
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
                  ? <img src={avatarUrl(m.user.profilePhoto, 64)} alt="" loading="lazy" decoding="async" className="w-6 h-6 rounded-full object-cover shrink-0" />
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
  const avatar = pulse.user.profilePhoto ? avatarUrl(pulse.user.profilePhoto, 128) : null
  const minsLeft = Math.max(0, Math.round((new Date(pulse.until).getTime() - Date.now()) / 60_000))
  const ttlLabel = minsLeft < 60 ? `${minsLeft}m left` : `${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m left`
  const [confirmingClear, setConfirmingClear] = useState(false)

  return (
    <div className={`rounded-2xl border p-3 flex items-center gap-3 ${
      pulse.isMine ? 'bg-amber-50 border-amber-200' : 'bg-white border-amber-100'
    }`}>
      {avatar
        ? <img src={avatar} alt={pulse.user.name} className="w-12 h-12 rounded-full object-cover shrink-0" />
        : <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
            style={{ backgroundColor: pulse.user.color }}>{pulse.user.name[0]}</div>}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
          {pulse.user.name}
          {countryFlag(pulse.user.nationality) && (
            <span className="text-base leading-none">{countryFlag(pulse.user.nationality)}</span>
          )}
          {pulse.isMine && <span className="text-amber-500 font-normal text-xs">(you)</span>}
        </p>
        <p className="text-xs text-amber-700 font-semibold mt-1">
          ✦ {pulse.note || 'Open to meeting up'}
          {pulse.neighborhood && (
            <span className="text-gray-500 font-normal"> · {pulse.neighborhood}</span>
          )}
        </p>
        <p className="text-[11px] text-gray-400 mt-0.5">{ttlLabel}</p>
      </div>
      {pulse.isMine ? (
        // Two-state inline clear — was a native confirm() in the parent.
        confirmingClear ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => { onClear?.(); setConfirmingClear(false) }}
              className="text-xs font-bold text-red-600 hover:text-red-700">Yes</button>
            <span className="text-xs text-gray-300">/</span>
            <button onClick={() => setConfirmingClear(false)}
              className="text-xs font-semibold text-gray-500 hover:text-gray-700">No</button>
          </div>
        ) : (
          <button onClick={() => setConfirmingClear(true)}
            className="text-xs text-gray-400 hover:text-gray-700 shrink-0">Clear</button>
        )
      ) : (
        <Link href={`/messages/${pulse.user.id}`}
          className="text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg shrink-0">
          Message
        </Link>
      )}
    </div>
  )
}
