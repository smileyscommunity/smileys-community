'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { ISTANBUL_NEIGHBORHOODS, resolveImageUrl, avatarUrl, getInitials } from '@/lib/data'
import { countryFlag } from '@/lib/countries'
import { matchesTimeFilter, statusBadge, type TimeFilter } from '@/lib/hangoutTime'
import { HANGOUT_ACTIVITIES, ACTIVITY_META, HANGOUT_CAPACITIES } from '@/lib/hangoutActivities'
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
  activity:     string | null
  // Total capacity INCLUDING the host; null = no limit.
  maxPeople:    number | null
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
  // "✋ I'm free too" responses — count + whether the viewer waved + the
  // first few wavers (posters see names, linked to DMs).
  waves:        { count: number; mine: boolean; users: { id: string; name: string }[] }
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
  photo:        string | null
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

  const fmtTime = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })
  // Day comparisons in Istanbul, not the device tz.
  const istDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })

  let prefix = ''
  if (minsToStart < 0)        prefix = 'Now · '
  else if (minsToStart < 60)  prefix = `In ${minsToStart}m · `
  else if (istDay(s) === istDay(now)) prefix = 'Today · '
  else                        prefix = s.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }) + ' · '

  return `${prefix}${fmtTime(s)}–${fmtTime(e)}`
}

// Live/upcoming split + human label. Once a hangout is running, the raw
// window stops answering the reader's actual question — "can I still make
// it?" — so live cards say how long it's been going and when it ends.
function timeStatus(startsAt: string, endsAt: string): { live: boolean; label: string } {
  const s = new Date(startsAt)
  const e = new Date(endsAt)
  const now = new Date()
  if (s <= now && e > now) {
    const fmtTime = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })
    const m = Math.round((now.getTime() - s.getTime()) / 60_000)
    const ago = m < 1 ? 'Just started' : m < 60 ? `Started ${m}m ago` : `Started ${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''} ago`
    return { live: true, label: `${ago} · until ${fmtTime(e)}` }
  }
  return { live: false, label: formatWindow(startsAt, endsAt) }
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
  // Ground rules: full box on the very first visit (norms matter in a
  // strangers-meet-strangers feature), a one-line collapsed bar after —
  // the permanent 4-bullet box was pushing the actual feed below the
  // fold on phones.
  const [rulesOpen, setRulesOpen] = useState(false)
  useEffect(() => {
    try {
      if (!localStorage.getItem('hangoutRulesSeen')) {
        setRulesOpen(true)
        localStorage.setItem('hangoutRulesSeen', '1')
      }
    } catch { /* private mode — stay collapsed */ }
  }, [])
  // Filter chips — exclusive: meet-mode + neighborhood. Toggleable: language.
  // All default to "off" / "all" so newcomers see the full feed by default;
  // filters are an explicit narrowing action.
  const [modeFilter,          setModeFilter]          = useState<ModeFilter>('all')
  const [timeFilter,          setTimeFilter]          = useState<TimeFilter>('all')
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
  const [activity,     setActivity]     = useState('')
  const [maxPeople,    setMaxPeople]    = useState(0) // 0 = no limit
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
  const QUICK_START_ACTIVITY: Record<string, string> = {
    Coffee: 'coffee', Drinks: 'drinks', Walk: 'walk', Food: 'food', Games: 'games', Cowork: 'cowork',
  }
  function quickStart(p: { label: string; title: string; description: string }) {
    setTitle(p.title)
    setDescription(p.description)
    setActivity(QUICK_START_ACTIVITY[p.label] ?? '')
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
          activity: activity || undefined,
          maxPeople: maxPeople || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Could not post'); return }
      toast.success('Hangout posted — neighbors are getting pinged')
      await loadFeed()
      setShowForm(false)
      setTitle(''); setLocation(''); setNeighborhood(''); setDescription(''); setActivity(''); setMaxPeople(0)
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

  // "✋ I'm free too" — optimistic flip; the poster gets a notification
  // deep-linking into a DM with the waver.
  async function handleWave(pulse: Pulse) {
    try {
      const res = await fetch(`/app/api/availability/${pulse.id}/wave`, { method: 'POST', credentials: 'include' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error ?? 'Could not wave'); return }
      setPulses(prev => prev.map(p => p.id === pulse.id
        ? { ...p, waves: { ...p.waves, mine: true, count: p.waves.mine ? p.waves.count : p.waves.count + 1 } }
        : p))
      toast.success(`${pulse.user.name.split(' ')[0]} will get a ping ✋`)
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-8 pb-5 sm:pb-6">
          <div className="max-w-3xl">
          {/* Header — stacks vertically on mobile so the two action buttons
              get a full row of their own (side by side, equal width).
              Desktop keeps the original side-by-side title/actions layout.
              Mobile trims the chip + title size — chip + 5xl title + tagline
              + buttons was nearly a full phone screen before any content. */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-3 mb-1">
            <div>
              <span className="hidden sm:inline-block bg-amber-100 text-amber-700 text-xs font-bold tracking-widest uppercase rounded-full px-4 py-1.5 mb-3">☕ Hangouts</span>
              <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-gray-900">Who&apos;s around?</h1>
              <p className="text-sm sm:text-base text-gray-600 mt-1">See what Smileys members are doing nearby — or start something yourself.</p>
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
                  <span className="text-sm font-bold">＋ Start a Hangout</span>
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

        {/* Ground rules — full box on first visit, one-line bar after
            (see rulesOpen). Norms stay one tap away without costing the
            feed half a phone screen on every visit. */}
        <div className="rounded-2xl border border-amber-100 bg-amber-50 overflow-hidden">
          <button onClick={() => setRulesOpen(o => !o)} aria-expanded={rulesOpen}
            className="w-full flex items-center justify-between gap-3 px-5 py-3 text-left">
            <p className="text-xs text-amber-900 truncate">
              <span className="font-bold uppercase tracking-widest text-amber-800">Ground rules</span>
              {!rulesOpen && <span className="text-amber-700"> · 📍 public places · don't leave joiners hanging</span>}
            </p>
            <span className={`text-amber-600 text-xs shrink-0 transition-transform ${rulesOpen ? 'rotate-180' : ''}`}>⌄</span>
          </button>
          {rulesOpen && (
            <ul className="space-y-2 px-5 pb-4">
              <li className="flex items-start gap-2 text-xs text-amber-900"><span>📍</span><span>Meet in public places only — no private addresses.</span></li>
              <li className="flex items-start gap-2 text-xs text-amber-900"><span>🚫</span><span>Cancel if plans change — don't leave joiners hanging.</span></li>
              <li className="flex items-start gap-2 text-xs text-amber-900"><span>🔁</span><span>No recurring events or commercial meetups — those go on the Events page.</span></li>
              <li className="flex items-start gap-2 text-xs text-amber-900"><span>⭐</span><span>After it ends, leave a recap so hosts build trust over time.</span></li>
            </ul>
          )}
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
            <div>
              <span className="block text-sm font-semibold text-gray-700 mb-1.5">What kind of thing? <span className="text-gray-400 font-normal">(optional)</span></span>
              <div className="flex gap-1.5 flex-wrap">
                {HANGOUT_ACTIVITIES.map(a => (
                  <button key={a.value} type="button" onClick={() => setActivity(activity === a.value ? '' : a.value)}
                    className={`text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-colors ${
                      activity === a.value ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:border-amber-300'
                    }`}>
                    {a.emoji} {a.label}
                  </button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="block text-sm font-semibold text-gray-700 mb-1.5">How many people? <span className="text-gray-400 font-normal">(including you)</span></span>
              <select value={maxPeople} onChange={e => setMaxPeople(Number(e.target.value))} className="input bg-white">
                <option value={0}>No limit</option>
                {HANGOUT_CAPACITIES.map(n => <option key={n} value={n}>{n} people</option>)}
              </select>
              <span className="block text-xs text-gray-400 mt-1">Expecting more than 10? That sounds like a Smileys Event.</span>
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
                <span className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Where <span className="text-gray-400 font-normal">(pings members living there)</span>
                </span>
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
            <div role="tablist" aria-label="Filter hangouts by time" className="contents">
              {([
                { v: 'all',      label: 'Any time' },
                { v: 'now',      label: '🟢 Now' },
                { v: 'today',    label: 'Today' },
                { v: 'tonight',  label: '🌙 Tonight' },
                { v: 'tomorrow', label: 'Tomorrow' },
              ] as { v: TimeFilter; label: string }[]).map(opt => (
                <button
                  key={opt.v}
                  onClick={() => setTimeFilter(opt.v)}
                  role="tab"
                  aria-selected={timeFilter === opt.v}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                    timeFilter === opt.v
                      ? 'bg-gray-900 text-white'
                      : 'bg-white text-gray-600 border border-gray-200 hover:border-gray-300'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
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
            if (!matchesTimeFilter(h, timeFilter)) return false
            if (modeFilter !== 'all' && h.meetMode !== modeFilter) return false
            if (neighborhoodFilter && h.neighborhood !== neighborhoodFilter) return false
            if (languageOnly) {
              const hostLangs = h.user.languages ?? []
              if (!hostLangs.some(l => myLangs.has(l))) return false
            }
            return true
          })

          // "Near you" — float the viewer's own-neighbourhood hangouts to the
          // top of whatever grouping renders below (stable sort keeps the
          // existing soonest-first order for everything else).
          if (user.neighborhood) {
            filtered.sort((a, b) =>
              (b.neighborhood === user.neighborhood ? 1 : 0) - (a.neighborhood === user.neighborhood ? 1 : 0))
          }

          if (filtered.length === 0 && pulses.length === 0) {
            const anyFilterOn = modeFilter !== 'all' || timeFilter !== 'all' || neighborhoodFilter !== null || languageOnly
            if (anyFilterOn) {
              return (
                <div className="text-center py-16">
                  <div aria-hidden="true" className="text-5xl mb-3">☕</div>
                  <p className="text-base font-bold text-gray-900 mb-1">Nothing matches your filters</p>
                  <p className="text-sm text-gray-600 max-w-md mx-auto">Clear a filter or two — or start something yourself.</p>
                </div>
              )
            }
            // True-empty state — for a spontaneity feature this is the
            // most-seen screen, so it has to invite rather than shrug.
            // One-tap route into the cheapest action (pulse) + the
            // regulars strip as social proof that the feature is alive.
            return (
              <div className="bg-white border border-gray-100 rounded-2xl shadow-sm px-6 py-10 text-center">
                <div aria-hidden="true" className="text-5xl mb-3">☕</div>
                <p className="text-base font-bold text-gray-900 mb-1">Quiet right now — be the spark</p>
                <p className="text-sm text-gray-600 max-w-md mx-auto">
                  Free this afternoon? Drop a pulse — it takes five seconds, and nearby members get a ping.
                </p>
                <button
                  onClick={() => { setShowPulseForm(true); setShowForm(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                  className="mt-4 inline-flex items-center gap-1.5 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
                  ✦ I&apos;m around
                </button>
                {regulars.length > 0 && (
                  <div className="mt-8 pt-6 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                      These members host often — a pulse might wake them up
                    </p>
                    <div className="flex gap-3 overflow-x-auto pb-1 justify-center">
                      {regulars.map(r => {
                        const photo = r.profilePhoto ? avatarUrl(r.profilePhoto, 128) : null
                        return (
                          <Link key={r.id} href={`/members/${r.id}`} className="flex flex-col items-center gap-1.5 min-w-[56px] group">
                            {photo
                              ? <img src={photo} alt={r.name} className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-sm group-hover:ring-2 group-hover:ring-amber-400 transition-all" />
                              : <div className="w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-bold border-2 border-white shadow-sm group-hover:ring-2 group-hover:ring-amber-400 transition-all"
                                  style={{ backgroundColor: r.color }}>
                                  {getInitials(r.name)}
                                </div>
                            }
                            <p className="text-xs font-medium text-gray-700 max-w-[56px] truncate group-hover:text-amber-600 transition-colors">
                              {r.name.split(' ')[0]}
                            </p>
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                )}
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
                    <PulseCard key={p.id} pulse={p} onClear={p.isMine ? handleClearPulse : undefined} onWave={handleWave} />
                  ))}
                </div>
              )}
              {/* Live/upcoming split — a hangout running RIGHT NOW is the
                  page's marquee moment and gets its own section with a
                  pulsing dot. Section headers only render when both exist;
                  a feed that's all-upcoming doesn't need a label. */}
              {(() => {
                const now      = Date.now()
                const isLive   = (h: Hangout) => new Date(h.startsAt).getTime() <= now && new Date(h.endsAt).getTime() > now
                const live     = filtered.filter(isLive)
                const upcoming = filtered.filter(h => !isLive(h))
                const renderCard = (h: Hangout) => (
                  <HangoutCard
                    key={h.id}
                    h={h}
                    currentUser={user}
                    onCancel={handleCancel}
                    onMutated={updated => {
                      setHangouts(prev => prev.map(pp => pp.id === updated.id ? updated : pp))
                    }}
                  />
                )
                return (
                  <>
                    {live.length > 0 && (
                      <div>
                        <p className="flex items-center gap-2 text-xs font-bold text-green-700 uppercase tracking-widest mb-3 px-1">
                          <span className="relative flex h-2 w-2" aria-hidden="true">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                          </span>
                          Happening now
                        </p>
                        <div className="space-y-3">{live.map(renderCard)}</div>
                      </div>
                    )}
                    {upcoming.length > 0 && (
                      <div>
                        {live.length > 0 && (
                          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3 px-1 pt-3">Coming up</p>
                        )}
                        <div className="space-y-3">{upcoming.map(renderCard)}</div>
                      </div>
                    )}
                  </>
                )
              })()}
            </>
          )
        })()}

        {/* Just happened — expired hangouts from the last 48h. Social proof
            that the feature is alive; also creates FOMO for newcomers. */}
        {!loading && recentHangouts.length > 0 && (
          <div className="pt-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 px-1">Just happened</p>
            <div className="space-y-2">
              {recentHangouts.map(h => {
                const hostAvatar = h.user.profilePhoto
                  ? avatarUrl(h.user.profilePhoto, 64)
                  : null
                const recapPhoto = h.photo ? resolveImageUrl(h.photo) : null
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
                    {recapPhoto && (
                      <img src={recapPhoto} alt="" loading="lazy" decoding="async"
                        className="w-12 h-12 rounded-lg object-cover shrink-0" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Regulars — top hosts this month. Social reward + newcomer
            signal. Skipped when the feed is empty: the empty state above
            already shows the same people with a stronger call-to-action. */}
        {!loading && regulars.length > 0 && (hangouts.length > 0 || pulses.length > 0) && (
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

// Shared, once-fetched Istanbul weather for outdoor hangout cards. Cached at
// module scope so many cards trigger a single open-meteo call (the CSP already
// allows api.open-meteo.com). Current conditions — only surfaced on today's
// hangouts, where "now" weather is actually representative.
const WCODE: Record<number, string> = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️', 45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️', 61: '🌦️', 63: '🌧️', 65: '🌧️',
  71: '🌨️', 73: '🌨️', 75: '❄️', 80: '🌦️', 81: '🌧️', 82: '⛈️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
}
let _wxCache: { temp: number; icon: string } | null = null
let _wxPromise: Promise<void> | null = null
function fetchWeatherOnce(): Promise<void> {
  if (!_wxPromise) {
    _wxPromise = fetch('https://api.open-meteo.com/v1/forecast?latitude=41.0082&longitude=28.9784&current_weather=true&timezone=Europe%2FIstanbul')
      .then(r => r.json())
      .then(d => { const c = d?.current_weather; if (c) _wxCache = { temp: Math.round(c.temperature), icon: WCODE[c.weathercode] ?? '🌤️' } })
      .catch(() => {})
  }
  return _wxPromise
}
const OUTDOOR_RE = /\b(picnic|walk|stroll|park|hike|hiking|beach|run|running|jog|cycl|bike|rooftop|garden|bosphorus|outdoor|swim|sail|kayak|frisbee|football|basketball|tennis|padel|climb|ferry|sunset)\b/i

function HangoutCard({ h, currentUser, onCancel, onMutated }: {
  h: Hangout
  // Real user from useAuth — used for ownership check + optimistic
  // join (was just `currentUserId: string`, which forced the just-
  // joined-me avatar to fall back to empty initials and a flat amber
  // circle until the next reload). profilePhoto is `string | null |
  // undefined` because useAuth's AppUser shape uses undefined; we
  // coerce to JoinerSummary's `string | null` at the optimistic add.
  currentUser: { id: string; name: string; color: string; profilePhoto?: string | null; role?: string }
  onCancel: (id: string) => void
  onMutated: (h: Hangout) => void
}) {
  const isOwner = h.user.id === currentUser.id
  // Staff can moderate any hangout: the PATCH/DELETE endpoints already
  // authorize admin/moderator (a staff cancel notifies joiners as "a
  // moderator"). Surface the same Edit/Cancel controls to them here so
  // they can act on a bad hangout straight from the feed. Joining stays
  // owner-gated (isOwner) — staff still join others' hangouts normally.
  const isStaff   = currentUser.role === 'admin' || currentUser.role === 'moderator'
  const canManage = isOwner || isStaff
  // Weather chip: outdoor-keyword hangouts happening today get a live temp.
  const isOutdoor = OUTDOOR_RE.test(`${h.title} ${h.description ?? ''}`)
  const isToday   = new Date(h.startsAt).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
                    === new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' })
  const [wx, setWx] = useState<{ temp: number; icon: string } | null>(null)
  useEffect(() => {
    if (isOutdoor && isToday) fetchWeatherOnce().then(() => setWx(_wxCache))
  }, [isOutdoor, isToday])
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

  // Inline edit (owner only). Seeded from the current hangout each time the
  // form is opened so re-opening after a cancel-edit doesn't keep stale text.
  const [editing,       setEditing]       = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [editUploading, setEditUploading] = useState(false)
  const [eTitle,        setETitle]        = useState(h.title)
  const [eLocation,     setELocation]     = useState(h.location)
  const [eNeighborhood, setENeighborhood] = useState(h.neighborhood ?? '')
  const [eDescription,  setEDescription]  = useState(h.description ?? '')
  const [eStartsAt,     setEStartsAt]     = useState(toIstanbulInputValue(new Date(h.startsAt)))
  const [eEndsAt,       setEEndsAt]       = useState(toIstanbulInputValue(new Date(h.endsAt)))
  const [ePhoto,        setEPhoto]        = useState<string | null>(h.photo)

  function openEdit() {
    // Reseed from the live hangout so the form always reflects current data.
    setETitle(h.title); setELocation(h.location); setENeighborhood(h.neighborhood ?? '')
    setEDescription(h.description ?? '')
    setEStartsAt(toIstanbulInputValue(new Date(h.startsAt)))
    setEEndsAt(toIstanbulInputValue(new Date(h.endsAt)))
    setEPhoto(h.photo)
    setConfirmingCancel(false)
    setEditing(true)
  }

  async function handleEditPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setEditUploading(true)
    try {
      const upload = await downscaleImage(file)
      const fd = new FormData()
      fd.append('file', upload)
      fd.append('folder', 'hangouts')
      const r = await fetch('/app/api/upload', { method: 'POST', credentials: 'include', body: fd }).then(res => res.json())
      if (r?.url) setEPhoto(r.url)
      else toast.error(r?.error ?? 'Upload failed')
    } catch {
      toast.error('Upload failed')
    } finally {
      setEditUploading(false)
      e.target.value = ''
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!eTitle.trim() || !eLocation.trim()) { toast.error('Title and location are required'); return }
    setSaving(true)
    try {
      const res = await fetch(`/app/api/hangouts/${h.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:        eTitle,
          location:     eLocation,
          neighborhood: eNeighborhood || null,
          description:  eDescription || null,
          startsAt:     istanbulInputToISO(eStartsAt),
          endsAt:       istanbulInputToISO(eEndsAt),
          // null clears the photo; a URL adds/replaces it.
          photo:        ePhoto,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Could not save'); return }
      toast.success('Hangout updated')
      onMutated({ ...h, ...data.hangout })
      setEditing(false)
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

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
  const status   = timeStatus(h.startsAt, h.endsAt)
  return (
    <div className={`bg-white border rounded-2xl overflow-hidden ${status.live ? 'border-green-200 ring-1 ring-green-100 shadow-md' : 'border-gray-100 shadow-sm'}`}>
      {/* Location photo — full-bleed at top with the title laid over a
          gradient, poster-style. Without the overlay the photo and the
          text block below competed for attention; now the photo IS the
          title card, and the body below starts at the time line. */}
      {photoUrl && (
        <Link href={`/hangouts/${h.id}`} className="block relative">
          <img src={photoUrl} alt={h.title} className="w-full h-40 object-cover" />
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
          <p className="absolute bottom-3 left-4 right-4 text-white text-base font-bold leading-snug drop-shadow-sm">
            {h.title}
          </p>
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
            {/* Title lives on the photo overlay when there is one — repeating
                it here would double it up. Photo-less cards show it inline,
                bumped to text-base so the card has a clear headline. */}
            {!photoUrl && (
              <Link href={`/hangouts/${h.id}`} className="text-base font-bold text-gray-900 leading-snug hover:text-amber-700">{h.title}</Link>
            )}
            {/* Intent badge — only renders for 'solo' since 'group' is the
                default and adding "open to all" everywhere is noise. */}
            {h.meetMode === 'solo' && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold border border-amber-200 shrink-0">
                1-on-1
              </span>
            )}
            {h.activity && ACTIVITY_META[h.activity] && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[10px] font-semibold border border-gray-200 shrink-0">
                {ACTIVITY_META[h.activity].emoji} {ACTIVITY_META[h.activity].label}
              </span>
            )}
            {(() => {
              const b = statusBadge(h.startsAt, h.endsAt)
              return b && (
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${b.cls}`}>
                  {b.label}
                </span>
              )
            })()}
          </div>
          <p className={`text-sm font-bold mt-0.5 flex items-center gap-1.5 ${status.live ? 'text-green-700' : 'text-amber-700'}`}>
            {status.live && (
              <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
              </span>
            )}
            {status.label}
          </p>
          <p className="text-xs text-gray-600 mt-1.5">📍 {h.location}{h.neighborhood && <span className="text-gray-400"> · {h.neighborhood}</span>}{wx && <span className="text-gray-400"> · {wx.icon} {wx.temp}°</span>}</p>
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
        {canManage && (
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
            <div className="flex items-center gap-2 shrink-0">
              {!editing && !status.live && (
                <button onClick={openEdit}
                  className="text-xs text-gray-400 hover:text-gray-700">Edit</button>
              )}
              <button onClick={() => setConfirmingCancel(true)}
                className="text-xs text-gray-400 hover:text-gray-700">Cancel</button>
            </div>
          )
        )}
      </div>

      {/* Inline edit form (owner or staff). Mirrors the composer's field set +
          photo add/replace/remove. Material changes (title/location/times)
          notify joiners server-side. */}
      {canManage && editing && (
        <form onSubmit={saveEdit} className="mt-4 pt-4 border-t border-gray-100 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Title</label>
            <input value={eTitle} onChange={e => setETitle(e.target.value)} maxLength={120}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Location</label>
            <input value={eLocation} onChange={e => setELocation(e.target.value)} maxLength={200}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Neighborhood</label>
            <select value={eNeighborhood} onChange={e => setENeighborhood(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:ring-2 focus:ring-amber-400 focus:border-amber-400">
              <option value="">— none —</option>
              {ISTANBUL_NEIGHBORHOODS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Description</label>
            <textarea value={eDescription} onChange={e => setEDescription(e.target.value)} maxLength={500} rows={2}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Starts</label>
              <input type="datetime-local" value={eStartsAt} onChange={e => setEStartsAt(e.target.value)}
                className="w-full px-2 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Ends</label>
              <input type="datetime-local" value={eEndsAt} onChange={e => setEEndsAt(e.target.value)}
                className="w-full px-2 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Photo</label>
            {ePhoto ? (
              <div className="flex items-center gap-3">
                <img src={resolveImageUrl(ePhoto)} alt="Hangout spot" className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-amber-700 cursor-pointer hover:text-amber-800">
                    🔄 {editUploading ? 'Uploading…' : 'Replace'}
                    <input type="file" accept="image/*" className="hidden" onChange={handleEditPhoto} disabled={editUploading} />
                  </label>
                  <button type="button" onClick={() => setEPhoto(null)}
                    className="text-xs font-semibold text-red-500 hover:text-red-600 text-left">🗑 Remove</button>
                </div>
              </div>
            ) : (
              <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-gray-300 text-xs font-semibold text-gray-600 cursor-pointer hover:border-amber-400 hover:text-amber-700">
                📷 {editUploading ? 'Uploading…' : 'Add photo'}
                <input type="file" accept="image/*" className="hidden" onChange={handleEditPhoto} disabled={editUploading} />
              </label>
            )}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button type="submit" disabled={saving || editUploading}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-bold">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" onClick={() => setEditing(false)}
              className="px-3 py-2 text-sm font-semibold text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </form>
      )}

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

        {!isOwner && (() => {
          // maxPeople includes the host; "going" (joiners+1) is compared
          // against it. A member already in can always leave a full hangout.
          const going     = h.joiners.length + 1
          const spotsLeft = h.maxPeople ? h.maxPeople - going : null
          const isFull    = spotsLeft !== null && spotsLeft <= 0 && !h.joinedByMe
          return (
            <div className="flex items-center gap-1.5 shrink-0">
              {spotsLeft !== null && spotsLeft > 0 && spotsLeft <= 3 && !h.joinedByMe && (
                <span className="text-[10px] font-bold text-orange-600 whitespace-nowrap">{spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left</span>
              )}
              <button onClick={toggleJoin} disabled={joining || isFull}
                className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${
                  isFull
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : h.joinedByMe
                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                      : 'bg-amber-500 text-white hover:bg-amber-600'
                }`}>
                {isFull ? 'Full' : h.joinedByMe ? 'You’re in ✓' : "I’m in"}
              </button>
            </div>
          )
        })()}

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
                  <p className="text-xs"><span className="font-semibold text-gray-900">{m.user.name}</span> <span className="text-gray-400">· {new Date(m.createdAt).toLocaleTimeString('en-GB', { timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })}</span></p>
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
function PulseCard({ pulse, onClear, onWave }: { pulse: Pulse; onClear?: () => void; onWave?: (p: Pulse) => void }) {
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
        {/* Waves feedback — the poster sees WHO is free too (names deep-
            link into DMs); everyone else just sees momentum ("2 waved"). */}
        {pulse.waves.count > 0 && (
          <p className="text-[11px] text-green-700 font-semibold mt-1">
            ✋ {pulse.isMine
              ? <>
                  {pulse.waves.users.map((u, i) => (
                    <span key={u.id}>
                      {i > 0 && ', '}
                      <Link href={`/messages/${u.id}`} className="underline decoration-green-300 hover:text-green-800">{u.name.split(' ')[0]}</Link>
                    </span>
                  ))}
                  {pulse.waves.count > pulse.waves.users.length && ` +${pulse.waves.count - pulse.waves.users.length}`}
                  {' '}{pulse.waves.count === 1 ? 'is' : 'are'} free too — say hi!
                </>
              : `${pulse.waves.count} waved`}
          </p>
        )}
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
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {/* One-tap mutual signal first; the DM comes after someone waves
              back. Waving is cheaper than opening a chat with a stranger. */}
          {pulse.waves.mine ? (
            <span className="text-xs font-bold text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg">✋ Waved</span>
          ) : (
            <button onClick={() => onWave?.(pulse)}
              className="text-xs font-bold text-white bg-amber-500 hover:bg-amber-600 px-3 py-1.5 rounded-lg">
              ✋ I&apos;m free too
            </button>
          )}
          <Link href={`/messages/${pulse.user.id}`}
            className="text-xs font-semibold text-amber-700 hover:text-amber-800 px-1">
            Message
          </Link>
        </div>
      )}
    </div>
  )
}
