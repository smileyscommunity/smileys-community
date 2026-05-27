'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { ISTANBUL_NEIGHBORHOODS, resolveImageUrl } from '@/lib/data'
import { toast } from 'sonner'

// Spontaneous hangouts — members only (real-time, contact-required). Auto-
// expires server-side via the cron when endsAt is past.

interface Hangout {
  id:           string
  title:        string
  description:  string | null
  location:     string
  neighborhood: string | null
  startsAt:     string
  endsAt:       string
  status:       string
  user: { id: string; name: string; color: string; profilePhoto: string | null }
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
  const [loading,  setLoading]  = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Form
  const [title,        setTitle]        = useState('')
  const [location,     setLocation]     = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [description,  setDescription]  = useState('')
  const [startsAt,     setStartsAt]     = useState(defaultStartsAt())
  const [endsAt,       setEndsAt]       = useState(defaultEndsAt())
  const [submitting,   setSubmitting]   = useState(false)

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login?next=/hangouts')
  }, [isLoading, isLoggedIn, router])

  useEffect(() => {
    if (!isLoggedIn) return
    fetch('/app/api/hangouts', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setHangouts(Array.isArray(d.hangouts) ? d.hangouts : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [isLoggedIn])

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
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Could not post'); return }
      toast.success('Hangout posted — neighbors are getting pinged')
      // Reload list
      const fresh = await fetch('/app/api/hangouts', { credentials: 'include' }).then(r => r.json())
      setHangouts(Array.isArray(fresh.hangouts) ? fresh.hangouts : [])
      setShowForm(false)
      setTitle(''); setLocation(''); setNeighborhood(''); setDescription('')
      setStartsAt(defaultStartsAt()); setEndsAt(defaultEndsAt())
    } catch {
      toast.error('Network error')
    } finally {
      setSubmitting(false)
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
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-1">Spontaneous</p>
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">Hangouts</h1>
              <p className="text-sm text-gray-500 mt-1">&quot;I&apos;m at X right now — join me?&quot;</p>
            </div>
            <button onClick={() => setShowForm(s => !s)}
              className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
              {showForm ? '× Close' : '＋ Post one'}
            </button>
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
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Note <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={500} rows={2}
                placeholder="What you're up for — quiet work, chatty, walk after…"
                className="input resize-none" />
            </div>
            <button type="submit" disabled={submitting}
              className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors">
              {submitting ? 'Posting…' : 'Post hangout'}
            </button>
          </form>
        )}

        {loading ? (
          <p className="text-center text-gray-400 text-sm py-10">Loading…</p>
        ) : hangouts.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-3">☕</div>
            <p className="text-base font-bold text-gray-900 mb-1">Nothing right now</p>
            <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
              Be the first — post where you are and who you&apos;d like to share an hour with.
            </p>
            <button onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl">
              Post a hangout
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {hangouts.map(h => {
              const isOwner = h.user.id === user.id
              const avatar  = resolveImageUrl(h.user.profilePhoto)
              return (
                <div key={h.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    {avatar
                      ? <img src={avatar} alt={h.user.name} className="w-10 h-10 rounded-full object-cover shrink-0" />
                      : <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                          style={{ backgroundColor: h.user.color }}>{h.user.name[0]}</div>}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900 leading-snug">{h.title}</p>
                      <p className="text-xs text-amber-700 font-semibold mt-0.5">{formatWindow(h.startsAt, h.endsAt)}</p>
                      <p className="text-xs text-gray-600 mt-1.5">📍 {h.location}{h.neighborhood && <span className="text-gray-400"> · {h.neighborhood}</span>}</p>
                      {h.description && (
                        <p className="text-xs text-gray-500 mt-2 whitespace-pre-wrap">{h.description}</p>
                      )}
                      <p className="text-[11px] text-gray-400 mt-2">Posted by {isOwner ? 'you' : h.user.name}</p>
                    </div>
                    {isOwner && (
                      <button onClick={() => handleCancel(h.id)}
                        className="text-xs text-gray-400 hover:text-red-500 shrink-0">Cancel</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

      </div>
    </div>
  )
}
